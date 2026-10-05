import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { scoreCandidate, type ScoredCandidate } from '../matching/candidate-scoring';
import { MatchingService } from '../matching/matching.service';
import { rankPlausibleCandidates } from './candidate-prefilter';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { advanceRotationCursorPastProcessed, selectDiscoveryTargets, type DiscoveryFilters } from './discovery-targets';
import { requestParsedProduct, requestSearch } from './parser-client';
import type { ParsedProduct, ParsedVariant, SearchResultItem } from './parser-client.types';
import { buildCompetitorSearchQuery } from './search-query-builder';

const OVICO_COMPETITOR = { name: 'OVICO', domain: 'ovico.md' };
const ROTATION_QUEUE_KEY = 'ovico-discovery';

// OVICO costs ~30s per HTTP request (mandatory Crawl-delay: 30, enforced by
// the parser service's rate limiter - not bypassed here). 1 search + up to
// 5 parses like MAKEUP would be ~3 minutes per SKU and cannot scale. Cap
// parsing at 1 candidate normally, 2 only when the top candidate is clearly
// weak - see sync() below.
const MAX_CANDIDATES_PARSED = 2;

export type OvicoTargetedSyncOptions = {
  limit?: number;
  productIds?: number[];
  brand?: string;
  inStock?: boolean;
  onlyUnmatched?: boolean;
};

export type OvicoTargetedAutoMatch = {
  vizajeId: number;
  vizajeBrand: string;
  vizajeName: string;
  competitorExternalId: string;
  competitorTitle: string;
  variantLabel: string | null;
  variantVolume: string | null;
  price: number | null;
  score: number;
  outcome: string;
};

export type OvicoTargetedSyncResult = {
  filters: DiscoveryFilters;
  eligibleProducts: number;
  productsAttempted: number;
  searchRequests: number;
  candidateParses: number;
  auto: number;
  ambiguous: number;
  noMatch: number;
  errors: number;
  autoMatches: OvicoTargetedAutoMatch[];
  durationMs: number;
};

// One structured line per attempted product, logged at DEBUG level only -
// the normal-path counterpart to the existing logger.warn() error logs.
// Exists so a low-yield production run can be diagnosed from real logs
// (see the discovery-quality investigation) instead of needing a one-off
// script to reconstruct query -> search -> prefilter -> parse -> score.
type OvicoDiscoveryDiagnostic = {
  productId: number;
  query: string | null;
  rawResultCount: number;
  rankedCount: number;
  parsedCount: number;
  decision: 'auto' | 'ambiguous' | 'noMatch' | 'error';
  score: number | null;
  rejectReason: string | null;
};

@Injectable()
export class OvicoTargetedSyncService {
  private readonly logger = new Logger(OvicoTargetedSyncService.name);
  private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(
    private readonly database: DatabaseService,
    private readonly persistence: CompetitorPersistenceService,
    private readonly matching: MatchingService,
  ) {}

  async sync(options: OvicoTargetedSyncOptions): Promise<OvicoTargetedSyncResult> {
    const startedAt = Date.now();

    const selection = await selectDiscoveryTargets(
      this.database,
      OVICO_COMPETITOR.domain,
      ROTATION_QUEUE_KEY,
      5,
      options,
    );
    const { targets } = selection;
    const competitor = await this.persistence.getOrCreateCompetitor(OVICO_COMPETITOR);

    let searchRequests = 0;
    let candidateParses = 0;
    let auto = 0;
    let ambiguous = 0;
    let noMatch = 0;
    let errors = 0;
    const autoMatches: OvicoTargetedAutoMatch[] = [];

    for (const vizaje of targets) {
      // Structured per-product diagnostic trail (§2 of the discovery-
      // quality investigation) - logged once per product via a single
      // logger.debug() JSON line, never changing what the loop actually
      // does. Populated incrementally as the product moves through the
      // normal (non-error) path below.
      const diag: OvicoDiscoveryDiagnostic = {
        productId: vizaje.id,
        query: null,
        rawResultCount: 0,
        rankedCount: 0,
        parsedCount: 0,
        decision: 'error',
        score: null,
        rejectReason: null,
      };

      let ranked: (SearchResultItem & { prefilterSimilarity: number })[];

      try {
        const query = buildCompetitorSearchQuery(vizaje);
        diag.query = query;

        const search = await requestSearch(this.parserUrl, '/search/ovico', query, 5);
        searchRequests += 1;
        diag.rawResultCount = search.results.length;

        // Cheap pre-ranking BEFORE any product-page fetch - OVICO's own
        // search order is not reliable (see module comment), so this is the
        // signal that decides parse order, not the site's ranking.
        ranked = rankPlausibleCandidates(vizaje, search.results);
        diag.rankedCount = ranked.length;
      } catch (error) {
        errors += 1;
        this.logger.warn(`search failed for vizaje id=${vizaje.id}: ${String(error)}`);
        this.logDiagnostic(diag);
        continue;
      }

      if (ranked.length === 0) {
        noMatch += 1;
        diag.decision = 'noMatch';
        this.logDiagnostic(diag);
        continue;
      }

      let bestAuto: { parsed: ParsedProduct; variant: ParsedVariant; result: ScoredCandidate } | null = null;
      let sawAmbiguous = false;

      for (const candidate of ranked.slice(0, MAX_CANDIDATES_PARSED)) {
        let parsed: ParsedProduct;

        try {
          parsed = await requestParsedProduct(this.parserUrl, '/parse/ovico/product', candidate.url);
        } catch (error) {
          this.logger.warn(`parse failed for ${candidate.url}: ${String(error)}`);
          continue;
        }

        candidateParses += 1;
        diag.parsedCount += 1;

        for (const variant of parsed.variants) {
          const result = scoreCandidate(vizaje, {
            title: parsed.title,
            variantLabel: variant.label,
            variantVolume: variant.volume,
          });

          // Track the best-scoring candidate seen so far for the
          // diagnostic, independent of the auto/ambiguous decision logic
          // below - this is purely observational.
          if (diag.score === null || result.score > diag.score) {
            diag.score = result.score;
            diag.rejectReason = result.rejectReason;
          }

          if (result.decision === 'auto') {
            if (!bestAuto || result.score > bestAuto.result.score) {
              bestAuto = { parsed, variant, result };
            }
          } else if (result.decision === 'ambiguous') {
            sawAmbiguous = true;
          }
        }

        // Stop after the first candidate unless it came back clearly weak -
        // that's the whole point of the request-budget cap. "Clearly weak"
        // means nothing auto and nothing even ambiguous from it.
        if (bestAuto || sawAmbiguous) {
          break;
        }
      }

      if (!bestAuto) {
        if (sawAmbiguous) {
          ambiguous += 1;
          diag.decision = 'ambiguous';
        } else {
          noMatch += 1;
          diag.decision = 'noMatch';
        }
        this.logDiagnostic(diag);
        continue;
      }

      diag.decision = 'auto';
      diag.score = bestAuto.result.score;
      diag.rejectReason = null;

      try {
        const persisted = await this.persistence.persistProduct(competitor.id, bestAuto.parsed);
        const variantId = bestAuto.variant.external_id
          ? persisted.variantIdByExternalId.get(bestAuto.variant.external_id)
          : undefined;

        if (!variantId) {
          errors += 1;
          diag.decision = 'error';
          this.logDiagnostic(diag);
          continue;
        }

        const { outcome } = await this.matching.persistSingleAutoMatch(
          vizaje.id,
          competitor.id,
          variantId,
          bestAuto.result.score,
        );

        auto += 1;
        autoMatches.push({
          vizajeId: vizaje.id,
          vizajeBrand: vizaje.brand,
          vizajeName: vizaje.name,
          competitorExternalId: bestAuto.parsed.external_id ?? '',
          competitorTitle: bestAuto.parsed.title,
          variantLabel: bestAuto.variant.label,
          variantVolume: bestAuto.variant.volume,
          price: bestAuto.variant.price,
          score: bestAuto.result.score,
          outcome,
        });
        this.logDiagnostic(diag);
      } catch (error) {
        errors += 1;
        diag.decision = 'error';
        this.logger.warn(`persist failed for vizaje id=${vizaje.id}: ${String(error)}`);
        this.logDiagnostic(diag);
      }
    }

    if (selection.usedRotation) {
      advanceRotationCursorPastProcessed(ROTATION_QUEUE_KEY, targets, []);
    }

    return {
      filters: selection.filters,
      eligibleProducts: selection.eligibleProducts,
      productsAttempted: targets.length,
      searchRequests,
      candidateParses,
      auto,
      ambiguous,
      noMatch,
      errors,
      autoMatches,
      durationMs: Date.now() - startedAt,
    };
  }

  private logDiagnostic(diag: OvicoDiscoveryDiagnostic): void {
    this.logger.debug(JSON.stringify(diag));
  }
}
