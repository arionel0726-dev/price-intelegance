import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { advanceRotationCursorPastProcessed, selectDiscoveryTargets, type DiscoveryFilters } from './discovery-targets';
import { OvicoSkuDiscoveryService } from './ovico-sku-discovery.service';

const OVICO_COMPETITOR = { name: 'OVICO', domain: 'ovico.md' as const };
const ROTATION_QUEUE_KEY = 'ovico-discovery';

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

// Milestone 2 note: the per-product search/score/persist logic now lives
// entirely in OvicoSkuDiscoveryService (see that file) - this class is
// just the legacy batch-shaped CLI/cron entry point that loops over it,
// unchanged in observable behavior. DiscoveryWorkerService (Milestone 2)
// calls the same OvicoSkuDiscoveryService.processOne() directly, one
// product at a time - OVICO never had cross-SKU batching/cooldown logic,
// so no adaptation was needed on that front (unlike MAKEUP).
@Injectable()
export class OvicoTargetedSyncService {
  private readonly logger = new Logger(OvicoTargetedSyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly persistence: CompetitorPersistenceService,
    private readonly skuDiscovery: OvicoSkuDiscoveryService,
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

    let candidateParses = 0;
    let auto = 0;
    let ambiguous = 0;
    let noMatch = 0;
    let errors = 0;
    const autoMatches: OvicoTargetedAutoMatch[] = [];

    for (const vizaje of targets) {
      const outcome = await this.skuDiscovery.processOne(vizaje, competitor, null);
      // OVICO never produces 'deferred' (that variant is MAKEUP-only, see
      // sku-discovery.types.ts) - every actual outcome here carries
      // parseSuccesses.
      if (outcome.kind !== 'deferred') candidateParses += outcome.parseSuccesses;

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
          break;
        case 'ambiguous':
          ambiguous += 1;
          break;
        case 'no_match':
          noMatch += 1;
          break;
        case 'error':
          if (outcome.reason === 'candidate_parse_failed') {
            noMatch += 1;
          } else {
            errors += 1;
          }
          break;
        case 'deferred':
          // Never produced for OVICO - exhaustive switch guard only.
          break;
      }
    }

    if (selection.usedRotation) {
      advanceRotationCursorPastProcessed(ROTATION_QUEUE_KEY, selection.rotationWindow, []);
    }

    return {
      filters: selection.filters,
      eligibleProducts: selection.eligibleProducts,
      productsAttempted: targets.length,
      searchRequests: targets.length,
      candidateParses,
      auto,
      ambiguous,
      noMatch,
      errors,
      autoMatches,
      durationMs: Date.now() - startedAt,
    };
  }
}
