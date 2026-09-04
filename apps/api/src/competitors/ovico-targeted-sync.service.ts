import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  competitorProductVariants,
  competitorProducts,
  competitors,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  matches,
  notInArray,
  products,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { scoreCandidate, type ScoredCandidate } from '../matching/candidate-scoring';
import { MatchingService } from '../matching/matching.service';
import { rankPlausibleCandidates } from './candidate-prefilter';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { getRotationCursor, setRotationCursor } from './discovery-rotation';
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

    const targets = await this.loadTargets(options);
    const competitor = await this.persistence.getOrCreateCompetitor(OVICO_COMPETITOR);

    let searchRequests = 0;
    let candidateParses = 0;
    let auto = 0;
    let ambiguous = 0;
    let noMatch = 0;
    let errors = 0;
    const autoMatches: OvicoTargetedAutoMatch[] = [];

    for (const vizaje of targets) {
      let ranked: (SearchResultItem & { prefilterSimilarity: number })[];

      try {
        const query = buildCompetitorSearchQuery(vizaje);
        const search = await requestSearch(this.parserUrl, '/search/ovico', query, 5);
        searchRequests += 1;

        // Cheap pre-ranking BEFORE any product-page fetch - OVICO's own
        // search order is not reliable (see module comment), so this is the
        // signal that decides parse order, not the site's ranking.
        ranked = rankPlausibleCandidates(vizaje, search.results);
      } catch (error) {
        errors += 1;
        this.logger.warn(`search failed for vizaje id=${vizaje.id}: ${String(error)}`);
        continue;
      }

      if (ranked.length === 0) {
        noMatch += 1;
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

        for (const variant of parsed.variants) {
          const result = scoreCandidate(vizaje, {
            title: parsed.title,
            variantLabel: variant.label,
            variantVolume: variant.volume,
          });

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
        if (sawAmbiguous) ambiguous += 1;
        else noMatch += 1;
        continue;
      }

      try {
        const persisted = await this.persistence.persistProduct(competitor.id, bestAuto.parsed);
        const variantId = bestAuto.variant.external_id
          ? persisted.variantIdByExternalId.get(bestAuto.variant.external_id)
          : undefined;

        if (!variantId) {
          errors += 1;
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
      } catch (error) {
        errors += 1;
        this.logger.warn(`persist failed for vizaje id=${vizaje.id}: ${String(error)}`);
      }
    }

    if (!options.productIds || options.productIds.length === 0) {
      if (targets.length > 0) {
        const maxId = Math.max(...targets.map(t => t.id));
        setRotationCursor(ROTATION_QUEUE_KEY, maxId);
      }
    }

    return {
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

  private async loadTargets(options: OvicoTargetedSyncOptions): Promise<
    { id: number; brand: string; name: string; volume: string | null; color: string | null }[]
  > {
    const base = this.database.db
      .select({
        id: products.id,
        brand: products.brand,
        name: products.name,
        volume: products.volume,
        color: products.color,
      })
      .from(products);

    // Explicit productIds bypass the "not already matched" filter and the
    // rotation cursor below - see makeup-targeted-sync.service.ts for the
    // same pattern and reasoning.
    if (options.productIds && options.productIds.length > 0) {
      return base.where(
        and(isNotNull(products.url), inArray(products.id, options.productIds)),
      );
    }

    // Scoped to OVICO specifically - a product already matched on MAKEUP is
    // still a valid OVICO discovery target.
    const alreadyMatchedOnOvico = this.database.db
      .select({ productId: matches.productId })
      .from(matches)
      .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
      .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
      .where(eq(competitors.domain, 'ovico.md'));

    const limit = options.limit ?? 5;
    const cursor = getRotationCursor(ROTATION_QUEUE_KEY);
    const eligible = and(isNotNull(products.url), notInArray(products.id, alreadyMatchedOnOvico));

    const afterCursor = await base
      .where(and(eligible, gt(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit);

    if (afterCursor.length >= limit) {
      return afterCursor;
    }

    const wrapped = await base
      .where(and(eligible, lte(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit - afterCursor.length);

    return [...afterCursor, ...wrapped];
  }
}
