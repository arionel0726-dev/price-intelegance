import { Injectable, Logger } from '@nestjs/common';
import { competitorProducts, competitorProductVariants, competitors, eq, matches } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { OvicoSyncService } from './ovico-sync.service';

export type OvicoRefreshResult = {
  parentsAttempted: number;
  parentsUpdated: number;
  parentsFailed: number;
  variantsUpdated: number;
  failures: { url: string; error: string }[];
  durationMs: number;
};

// REFRESH, not discovery - see project notes. Targets only competitor_
// products rows already referenced by an existing match to OVICO, and
// re-parses each known URL directly. No search. Each parse still goes
// through the existing OVICO parser, which itself goes through the shared
// 30s rate limiter (ovico_get) - not bypassed here, just not driven any
// harder than sequential awaiting already implies.
@Injectable()
export class OvicoRefreshService {
  private readonly logger = new Logger(OvicoRefreshService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly ovicoSync: OvicoSyncService,
  ) {}

  async refresh(): Promise<OvicoRefreshResult> {
    const startedAt = Date.now();

    const rows = await this.database.db
      .select({
        competitorProductId: competitorProducts.id,
        url: competitorProducts.url,
      })
      .from(matches)
      .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
      .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
      .where(eq(competitors.domain, 'ovico.md'));

    const uniqueUrlsByProductId = new Map<number, string>();
    for (const row of rows) uniqueUrlsByProductId.set(row.competitorProductId, row.url);

    let parentsUpdated = 0;
    let parentsFailed = 0;
    let variantsUpdated = 0;
    const failures: { url: string; error: string }[] = [];

    for (const url of uniqueUrlsByProductId.values()) {
      try {
        const result = await this.ovicoSync.syncProduct(url);
        parentsUpdated += 1;
        variantsUpdated += result.variantsPersisted;
      } catch (error) {
        parentsFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ url, error: message });
        this.logger.warn(`refresh failed for ${url}: ${message}`);
      }
    }

    return {
      parentsAttempted: uniqueUrlsByProductId.size,
      parentsUpdated,
      parentsFailed,
      variantsUpdated,
      failures,
      durationMs: Date.now() - startedAt,
    };
  }
}
