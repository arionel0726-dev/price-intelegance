import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { advanceRotationCursorPastProcessed, selectDiscoveryTargets, type DiscoveryFilters } from './discovery-targets';
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
import { MakeupSkuDiscoveryService } from './makeup-sku-discovery.service';
import { requestSearchBatch } from './parser-client';
import type { SearchResponse } from './parser-client.types';
import { buildCompetitorSearchQuery } from './search-query-builder';

const MAKEUP_COMPETITOR = { name: 'MAKEUP', domain: 'makeup.md' as const };
const ROTATION_QUEUE_KEY = 'makeup-discovery';

export type MakeupTargetedSyncOptions = {
  limit?: number;
  productIds?: number[];
  brand?: string;
  inStock?: boolean;
  onlyUnmatched?: boolean;
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

  filters: DiscoveryFilters;
  eligibleProducts: number;
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

// Milestone 2 note: the per-product search/score/persist logic below is
// now a thin loop over MakeupSkuDiscoveryService (see that file) - this
// class keeps ONLY the batch-shaped concerns that genuinely only make
// sense across several products at once: request batching, cooldown-
// pattern detection, inter-batch pacing, and per-run safety-limit ratios.
// The DiscoveryWorkerService (Milestone 2) calls the same
// MakeupSkuDiscoveryService directly, one product at a time, with its own
// adaptation of these batch-shaped concerns (MakeupCooldownTracker,
// proportional per-SKU pacing) - see project notes for exactly how, and
// the explicitly reported deviations that one-SKU adaptation required.
@Injectable()
export class MakeupTargetedSyncService {
  private readonly logger = new Logger(MakeupTargetedSyncService.name);
  private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(
    private readonly database: DatabaseService,
    private readonly persistence: CompetitorPersistenceService,
    private readonly skuDiscovery: MakeupSkuDiscoveryService,
  ) {}

  async sync(options: MakeupTargetedSyncOptions): Promise<MakeupTargetedSyncResult> {
    const startedAt = Date.now();

    const selection = await selectDiscoveryTargets(
      this.database,
      MAKEUP_COMPETITOR.domain,
      ROTATION_QUEUE_KEY,
      20,
      options,
    );
    const { targets } = selection;
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

        if (search.results.length === 0) legitimateZeroResults += 1;
        else foundCandidates += 1;

        const outcome = await this.skuDiscovery.scoreAndPersist(vizaje, competitor, search, null);

        switch (outcome.kind) {
          case 'auto':
            auto += 1;
            autoMatches.push({
              vizajeId: vizaje.id,
              vizajeBrand: vizaje.brand,
              vizajeName: vizaje.name,
              competitorExternalId: outcome.competitorExternalId,
              competitorTitle: outcome.competitorTitle,
              variantLabel: outcome.variantLabel,
              variantVolume: outcome.variantVolume,
              price: outcome.price,
              score: outcome.score,
              outcome: outcome.matchOutcome,
            });
            candidatesParsedTotal += outcome.parseSuccesses;
            break;
          case 'ambiguous':
            ambiguous += 1;
            candidatesParsedTotal += outcome.parseSuccesses;
            break;
          case 'no_match':
            noMatch += 1;
            candidatesParsedTotal += outcome.parseSuccesses;
            break;
          case 'error':
            if (outcome.reason === 'candidate_parse_failed') {
              // Kept in the `noMatch` counter for backward-compatible
              // run-report shape - see MakeupSkuDiscoveryService notes.
              noMatch += 1;
            } else {
              persistErrors += 1;
            }
            candidatesParsedTotal += outcome.parseSuccesses;
            break;
          case 'deferred':
            // Never produced by scoreAndPersist() itself (batch-level
            // cooldown is handled above, before this loop runs at all) -
            // exhaustive switch guard only.
            break;
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
    // past, since they were never actually searched. Only meaningful for the
    // unfiltered routine queue (see selectDiscoveryTargets's usedRotation) -
    // a filtered/random-selection run must not move this cursor.
    if (selection.usedRotation) {
      advanceRotationCursorPastProcessed(ROTATION_QUEUE_KEY, selection.rotationWindow, deferredProductIds);
    }

    return {
      status: stopReason ? 'stopped_early' : 'completed',
      stopReason,
      filters: selection.filters,
      eligibleProducts: selection.eligibleProducts,
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
}
