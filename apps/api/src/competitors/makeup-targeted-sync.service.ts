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
import { canonicalBrand } from '../matching/matching-normalization';
import { MatchingService } from '../matching/matching.service';
import { isPlausibleCandidate } from './candidate-prefilter';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { getRotationCursor, setRotationCursor } from './discovery-rotation';
import {
  chunk,
  detectCooldownPattern,
  MAKEUP_COOLDOWN_PROBE_SIZE,
  MAKEUP_COOLDOWN_WAIT_MS,
  MAKEUP_DISCOVERY_BATCH_PAUSE_MS,
  MAKEUP_DISCOVERY_BATCH_SIZE,
  MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN,
  MAKEUP_MAX_DEFERRED_RATIO,
  MAKEUP_MAX_SEARCH_ERROR_RATIO,
  sleep,
} from './makeup-discovery-pacing';
import { requestParsedProduct, requestSearchBatch } from './parser-client';
import type { ParsedProduct, ParsedVariant, SearchResponse } from './parser-client.types';
import { buildCompetitorSearchQuery } from './search-query-builder';

const MAKEUP_COMPETITOR = { name: 'MAKEUP', domain: 'makeup.md' };
const ROTATION_QUEUE_KEY = 'makeup-discovery';

// Top-of-funnel cap: how many search results even get the cheap pre-filter
// considered. The parser's own `/search/makeup` call is already asked for a
// small `limit`; this just guards against a future limit increase silently
// blowing up parse volume too.
const MAX_CANDIDATES_CONSIDERED = 5;
// How many of the plausible candidates actually get a full product-page
// parse (a real Playwright page load each) - "candidate generation, not
// matching": search finds a small pool, only a few of those are worth the
// parse cost.
const MAX_CANDIDATES_PARSED = 3;

export type MakeupTargetedSyncOptions = {
  limit?: number;
  productIds?: number[];
};

export type MakeupTargetedAutoMatch = {
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

export type MakeupTargetedSyncResult = {
  status: 'completed' | 'stopped_early';
  stopReason: string | null;

  productsAttempted: number;
  batches: number;
  batchSize: number;
  batchPauseMs: number;

  // Search-level outcome counts (FOUND_CANDIDATES / NO_RESULTS /
  // COOLDOWN_DEFERRED / SEARCH_ERROR - see project notes). Mutually
  // exclusive per product; sum to productsAttempted.
  searchRequestsTotal: number;
  foundCandidates: number;
  legitimateZeroResults: number;
  cooldownEvents: number;
  cooldownDeferred: number;
  searchErrors: number;
  deferredProductIds: number[];

  // Matcher-level outcome counts - only meaningful for products where
  // search actually returned candidates (foundCandidates).
  candidatesParsedTotal: number;
  auto: number;
  ambiguous: number;
  noMatch: number;
  persistErrors: number;

  autoMatches: MakeupTargetedAutoMatch[];
  durationMs: number;
};

@Injectable()
export class MakeupTargetedSyncService {
  private readonly logger = new Logger(MakeupTargetedSyncService.name);
  private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(
    private readonly database: DatabaseService,
    private readonly persistence: CompetitorPersistenceService,
    private readonly matching: MatchingService,
  ) {}

  async sync(options: MakeupTargetedSyncOptions): Promise<MakeupTargetedSyncResult> {
    const startedAt = Date.now();

    const targets = await this.loadTargets(options);
    const competitor = await this.persistence.getOrCreateCompetitor(MAKEUP_COMPETITOR);
    const batches = chunk(targets, MAKEUP_DISCOVERY_BATCH_SIZE);
    const plannedTotal = targets.length;

    let searchRequestsTotal = 0;
    let foundCandidates = 0;
    let legitimateZeroResults = 0;
    let cooldownEvents = 0;
    let searchErrors = 0;
    let candidatesParsedTotal = 0;
    let auto = 0;
    let ambiguous = 0;
    let noMatch = 0;
    let persistErrors = 0;
    const autoMatches: MakeupTargetedAutoMatch[] = [];
    const deferredProductIds: number[] = [];

    let cooldownActive = false;
    let stopReason: string | null = null;

    // Ratios use the RUN'S TOTAL planned target count as denominator (not a
    // shifting "so far" count) - a stable rule that doesn't flip on
    // early-run noise. See project notes, safety-limits section.
    const deferAllRemaining = (fromBatchIndex: number) => {
      for (const remainingBatch of batches.slice(fromBatchIndex)) {
        for (const vizaje of remainingBatch) deferredProductIds.push(vizaje.id);
      }
    };

    const exceedsSafetyLimits = (): string | null => {
      if (plannedTotal === 0) return null;
      if (deferredProductIds.length / plannedTotal > MAKEUP_MAX_DEFERRED_RATIO) {
        return 'deferred_ratio_exceeded';
      }
      if (searchErrors / plannedTotal > MAKEUP_MAX_SEARCH_ERROR_RATIO) {
        return 'search_error_ratio_exceeded';
      }
      return null;
    };

    batchLoop: for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]!;

      if (cooldownActive) {
        this.logger.warn(
          `cooldown active - waiting ${MAKEUP_COOLDOWN_WAIT_MS}ms then probing before batch ${batchIndex + 1}/${batches.length}`,
        );
        await sleep(MAKEUP_COOLDOWN_WAIT_MS);

        const probeTargets = batch.slice(0, MAKEUP_COOLDOWN_PROBE_SIZE);
        const probeQueries = probeTargets.map(v => buildCompetitorSearchQuery(v));
        let probeRecovered = false;

        try {
          const probe = await requestSearchBatch(this.parserUrl, '/search/makeup/batch', probeQueries, 5);
          searchRequestsTotal += probeQueries.length;
          probeRecovered = probe.results.some(r => r.results.length > 0);
        } catch (error) {
          this.logger.warn(`cooldown probe request failed: ${String(error)}`);
        }

        if (!probeRecovered) {
          this.logger.warn(
            `cooldown probe still empty - deferring remaining ${batches.length - batchIndex} batch(es), stopping this run`,
          );
          deferAllRemaining(batchIndex);
          stopReason = 'cooldown_probe_failed';
          break;
        }

        this.logger.log('cooldown probe recovered - resuming normal batches');
        cooldownActive = false;
      }

      const queries = batch.map(vizaje => buildCompetitorSearchQuery(vizaje));
      let searchResults: SearchResponse[];

      try {
        const response = await requestSearchBatch(this.parserUrl, '/search/makeup/batch', queries, 5);
        searchResults = response.results;
        searchRequestsTotal += queries.length;
      } catch (error) {
        this.logger.warn(`search batch ${batchIndex + 1}/${batches.length} failed entirely: ${String(error)}`);
        searchErrors += batch.length;
        for (const vizaje of batch) deferredProductIds.push(vizaje.id);

        const limitReason = exceedsSafetyLimits();
        if (limitReason) {
          this.logger.warn(`safety limit hit (${limitReason}) - stopping run, deferring remainder`);
          deferAllRemaining(batchIndex + 1);
          stopReason = limitReason;
          break batchLoop;
        }
        continue;
      }

      const resultCounts = searchResults.map(result => result.results.length);

      if (detectCooldownPattern(resultCounts)) {
        // A 3rd cooldown in one run stops the whole run outright - do not
        // accept another 12+ minute wait for a run that is clearly having a
        // bad day against MAKEUP.
        if (cooldownEvents + 1 > MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN) {
          this.logger.warn(
            `cooldown limit reached (${MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN} per run) - stopping run, deferring remainder`,
          );
          deferAllRemaining(batchIndex);
          stopReason = 'cooldown_limit';
          break batchLoop;
        }

        cooldownEvents += 1;
        cooldownActive = true;
        this.logger.warn(
          `cooldown pattern detected in batch ${batchIndex + 1}/${batches.length} - deferring this batch, will probe before continuing`,
        );

        for (const vizaje of batch) deferredProductIds.push(vizaje.id);

        const limitReason = exceedsSafetyLimits();
        if (limitReason) {
          this.logger.warn(`safety limit hit (${limitReason}) - stopping run, deferring remainder`);
          deferAllRemaining(batchIndex + 1);
          stopReason = limitReason;
          break batchLoop;
        }
        continue;
      }

      for (let i = 0; i < batch.length; i++) {
        const vizaje = batch[i]!;
        const search = searchResults[i]!;

        if (search.results.length === 0) {
          legitimateZeroResults += 1;
          continue;
        }

        foundCandidates += 1;

        const plausible = search.results
          .filter(result => isPlausibleCandidate(vizaje, result))
          .slice(0, MAX_CANDIDATES_CONSIDERED)
          .slice(0, MAX_CANDIDATES_PARSED);

        if (plausible.length === 0) {
          noMatch += 1;
          continue;
        }

        let bestAuto: { parsed: ParsedProduct; variant: ParsedVariant; result: ScoredCandidate } | null = null;
        let sawAmbiguous = false;

        for (const candidate of plausible) {
          let parsed: ParsedProduct;

          try {
            parsed = await requestParsedProduct(this.parserUrl, '/parse/makeup/product', candidate.url);
          } catch (error) {
            this.logger.warn(`parse failed for ${candidate.url}: ${String(error)}`);
            continue;
          }

          candidatesParsedTotal += 1;

          if (canonicalBrand(vizaje.brand) !== canonicalBrand(parsed.brand)) {
            continue;
          }

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
            persistErrors += 1;
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
          persistErrors += 1;
          this.logger.warn(`persist failed for vizaje id=${vizaje.id}: ${String(error)}`);
        }
      }

      const limitReason = exceedsSafetyLimits();
      if (limitReason) {
        this.logger.warn(`safety limit hit (${limitReason}) - stopping run, deferring remainder`);
        deferAllRemaining(batchIndex + 1);
        stopReason = limitReason;
        break batchLoop;
      }

      const isLastBatch = batchIndex === batches.length - 1;
      if (!isLastBatch && !cooldownActive) {
        this.logger.log(`batch ${batchIndex + 1}/${batches.length} done - pausing ${MAKEUP_DISCOVERY_BATCH_PAUSE_MS}ms`);
        await sleep(MAKEUP_DISCOVERY_BATCH_PAUSE_MS);
      }
    }

    // Advance the rotation cursor only up to whatever was NOT deferred -
    // deferred products should be reconsidered by the next run, not skipped
    // past, since they were never actually searched.
    if (!options.productIds || options.productIds.length === 0) {
      const deferredSet = new Set(deferredProductIds);
      const actuallyProcessed = targets.filter(t => !deferredSet.has(t.id));

      if (actuallyProcessed.length > 0) {
        const maxProcessedId = Math.max(...actuallyProcessed.map(t => t.id));
        setRotationCursor(ROTATION_QUEUE_KEY, maxProcessedId);
      }
    }

    return {
      status: stopReason ? 'stopped_early' : 'completed',
      stopReason,
      productsAttempted: plannedTotal,
      batches: batches.length,
      batchSize: MAKEUP_DISCOVERY_BATCH_SIZE,
      batchPauseMs: MAKEUP_DISCOVERY_BATCH_PAUSE_MS,
      searchRequestsTotal,
      foundCandidates,
      legitimateZeroResults,
      cooldownEvents,
      cooldownDeferred: deferredProductIds.length,
      searchErrors,
      deferredProductIds,
      candidatesParsedTotal,
      auto,
      ambiguous,
      noMatch,
      persistErrors,
      autoMatches,
      durationMs: Date.now() - startedAt,
    };
  }

  private async loadTargets(options: MakeupTargetedSyncOptions): Promise<
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
    // rotation cursor below - used for testing, idempotency checks, and
    // deliberate re-discovery, not routine discovery.
    if (options.productIds && options.productIds.length > 0) {
      return base.where(
        and(isNotNull(products.url), inArray(products.id, options.productIds)),
      );
    }

    // Routine discovery queue: website-confirmed (products.url IS NOT NULL)
    // AND no existing MAKEUP match yet - scoped to THIS competitor only, so
    // a product already matched on OVICO (say) is still a valid MAKEUP
    // discovery target. Already-matched-on-MAKEUP products only need
    // REFRESH (a direct parse of their known URL), not another search.
    // "Not recently attempted" is intentionally not tracked via schema yet
    // (see project notes) - the rotation cursor below is the substitute:
    // deterministic id-ascending rotation, wrapping around, so repeated
    // runs don't keep re-selecting the same head of the table forever.
    const alreadyMatchedOnMakeup = this.database.db
      .select({ productId: matches.productId })
      .from(matches)
      .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
      .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
      .where(eq(competitors.domain, 'makeup.md'));

    const limit = options.limit ?? 20;
    const cursor = getRotationCursor(ROTATION_QUEUE_KEY);

    const eligible = and(isNotNull(products.url), notInArray(products.id, alreadyMatchedOnMakeup));

    const afterCursor = await base
      .where(and(eligible, gt(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit);

    if (afterCursor.length >= limit) {
      return afterCursor;
    }

    // Wrapped around - top up from the beginning of the table.
    const wrapped = await base
      .where(and(eligible, lte(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit - afterCursor.length);

    return [...afterCursor, ...wrapped];
  }
}
