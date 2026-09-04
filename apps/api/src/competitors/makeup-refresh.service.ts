import { Injectable, Logger } from '@nestjs/common';
import { competitorProducts, competitorProductVariants, competitors, eq, matches } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { MakeupSyncService } from './makeup-sync.service';

export type MakeupRefreshResult = {
  parentsAttempted: number;
  parentsUpdated: number;
  parentsFailed: number;
  variantsUpdated: number;
  failures: { url: string; error: string }[];
  durationMs: number;
};

// REFRESH, not discovery - see project notes on the distinction. Targets
// only competitor_products rows already referenced by an existing match to
// MAKEUP, and re-parses each known URL directly. No search, no matching
// logic, no pacing (MAKEUP's search-cooldown constraint does not apply to
// plain product-page parsing - confirmed during the pacing milestone).
@Injectable()
export class MakeupRefreshService {
  private readonly logger = new Logger(MakeupRefreshService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly makeupSync: MakeupSyncService,
  ) {}

  async refresh(): Promise<MakeupRefreshResult> {
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
      .where(eq(competitors.domain, 'makeup.md'));

    // One parse refreshes ALL of that parent's variants at once - dedupe by
    // parent so a product with several matched variants isn't parsed twice.
    const uniqueUrlsByProductId = new Map<number, string>();
    for (const row of rows) uniqueUrlsByProductId.set(row.competitorProductId, row.url);

    let parentsUpdated = 0;
    let parentsFailed = 0;
    let variantsUpdated = 0;
    const failures: { url: string; error: string }[] = [];

    for (const url of uniqueUrlsByProductId.values()) {
      try {
        const result = await this.makeupSync.syncProduct(url);
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
