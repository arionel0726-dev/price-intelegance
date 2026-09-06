import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { eq, matches, products, productBarcodes } from '@price/db';

import { DatabaseService } from '../database/database.service';
import {
  canonicalBrand,
  nameSimilarity,
  normalizeName,
  normalizeVolume,
  volumesMatch,
} from '../matching/matching-normalization';
import { VizajeBarcodeLookupService } from './vizaje-barcode-lookup.service';
import type {
  ParsedVizajeFamily,
  ParsedVizajeVariant,
  VizajeBatchResult,
} from './vizaje-parser-client.types';

type ExistingRow = {
  id: number;
  sourceId: string | null;
  sourceKey: string;
  barcode: string | null;
  brand: string;
  name: string;
  volume: string | null;
  color: string | null;
};

export type UnresolvedCollision = {
  sku: string;
  familyTitle: string;
  reason: 'jobvn_ambiguous' | 'existing_rows_ambiguous';
  candidateCount: number;
};

// A website-level collision: the same variation.sku shows up under more than
// one distinct family (ParsedVizajeFamily.external_id) within the same
// crawl/batch. This is a DIFFERENT concept from UnresolvedCollision (which is
// about JobVN barcode-identity ambiguity for a single, unambiguously-sourced
// SKU). We do not know which family is authoritative for these, so they are
// never persisted or resolved automatically - see vizaje-sync.service.ts.
export type CrossFamilyCollision = {
  sku: string;
  familyIds: string[];
  familyTitles: string[];
  urls: string[];
};

export type VizajeSyncResult = {
  familiesProcessed: number;
  skusProcessed: number;
  inserted: number;
  updated: number;
  barcodeEnriched: number;
  unresolvedCollisions: UnresolvedCollision[];
  crossFamilyCollisionCount: number;
  crossFamilyCollisions: CrossFamilyCollision[];
};

// A family URL that failed on the initial full-catalog parse pass and was
// retried individually (see retryFailures()). 'failed_stale' means a 404
// that was reconfirmed once and is treated as a stale sitemap entry, not a
// transient error. Families here are NEVER touched in the DB - their prior
// state is preserved exactly as-is.
export type FailedFamily = {
  externalId: string | null;
  url: string;
  error: string;
  attempts: number;
  finalOutcome: 'failed_transient' | 'failed_stale';
};

export type LegacyOnlyAuditSummary = {
  totalLegacyOnly: number;
  byAvailableStatus: { available: number; unavailable: number; unknown: number };
  byHasMatches: { withMatches: number; withoutMatches: number };
  byHasBarcode: { withBarcode: number; withoutBarcode: number };
  topBrands: { brand: string; count: number }[];
  topCategories: { category: string; count: number }[];
};

export type FullSyncResult = {
  familiesDiscovered: number;
  familiesParsed: number;
  familiesFailed: number;
  failedFamilies: FailedFamily[];
  variationEntries: number;
  distinctSkus: number;
  crossFamilyCollisionCount: number;
  crossFamilyCollisions: CrossFamilyCollision[];
  safeSkuCount: number;
  updated: number;
  inserted: number;
  barcodeEnriched: number;
  identityUnresolved: number;
  unresolvedCollisions: UnresolvedCollision[];
  legacyOnlyAudit: LegacyOnlyAuditSummary;
  durationMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const execFileAsync = promisify(execFile);

const DEFAULT_VIZAJE_SYNC_TIMEOUT_SECONDS = 10_800; // 3 hours

// How long curl waits for the full-catalog batch response (--max-time)
// before giving up. Configurable because slower VPS hardware can legitimately
// take longer than the ~30 min observed locally - a hardcoded 1-hour ceiling
// killed a real production run mid-crawl. Falls back to the 3-hour default
// on anything that isn't a positive integer, rather than passing a bad value
// (or NaN) straight to curl.
function resolveVizajeSyncTimeoutSeconds(): number {
  const raw = process.env.VIZAJE_SYNC_TIMEOUT_SECONDS;

  if (raw === undefined) {
    return DEFAULT_VIZAJE_SYNC_TIMEOUT_SECONDS;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_VIZAJE_SYNC_TIMEOUT_SECONDS;
  }

  return parsed;
}

@Injectable()
export class VizajeSyncService {
  private readonly logger = new Logger(VizajeSyncService.name);
  private readonly parserUrl =
    process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(
    private readonly database: DatabaseService,
    private readonly barcodeLookup: VizajeBarcodeLookupService,
  ) {}

  async sync(maxProducts: number | undefined): Promise<VizajeSyncResult> {
    const batch = await this.requestBatch(maxProducts);

    const { entries, crossFamilyCollisions } = this.detectCrossFamilyCollisions(
      batch.families,
    );
    const conflictedSkus = new Set(crossFamilyCollisions.map(c => c.sku));

    let inserted = 0;
    let updated = 0;
    let barcodeEnriched = 0;
    let skusProcessed = 0;
    const unresolvedCollisions: UnresolvedCollision[] = [];

    for (const { family, variant } of entries) {
      skusProcessed += 1;

      // Cross-family collision: skip entirely, do not touch any existing
      // DB row, do not run barcode resolution. We do not know which family
      // is authoritative, so no write of any kind happens for this SKU.
      if (conflictedSkus.has(variant.sku)) {
        continue;
      }

      const outcome = await this.persistVariant(family, variant);

      if (outcome.kind === 'skipped') {
        unresolvedCollisions.push(outcome.collision);
        continue;
      }

      if (outcome.kind === 'inserted') inserted += 1;
      else updated += 1;

      if (outcome.barcodeEnriched) barcodeEnriched += 1;
    }

    return {
      familiesProcessed: batch.families.length,
      skusProcessed,
      inserted,
      updated,
      barcodeEnriched,
      unresolvedCollisions,
      crossFamilyCollisionCount: crossFamilyCollisions.length,
      crossFamilyCollisions,
    };
  }

  // ---------------------------------------------------------------------
  // Full-catalog operational sync (two-phase - see project notes for the
  // reasoning). Intended to be run from the `vizaje:sync` CLI script, NOT
  // from an HTTP controller: a full crawl+parse pass alone takes ~30
  // minutes, and persistence of ~11k safe SKUs afterward adds more on top.
  // PHASE 1 (read/prepare): crawl+parse the whole catalog, retry transient
  // per-family failures, then run collision detection GLOBALLY across the
  // entire result before any DB write happens - this is what makes it safe
  // to persist in chunks afterward without a chunk missing a collision that
  // only shows up in a different chunk.
  // PHASE 2 (persist): write only SKUs outside the global conflicted set.
  // ---------------------------------------------------------------------
  async fullSync(): Promise<FullSyncResult> {
    const startedAt = Date.now();

    this.logger.log(
      'Full Vizaje sync: phase 1 - crawl + parse full catalog (can take ~30 min)',
    );
    const batch = await this.requestFullBatchViaCurl();
    this.logger.log(
      `Phase 1 initial pass: discovered=${batch.discovered} succeeded=${batch.succeeded} failed=${batch.failed}`,
    );

    const { recoveredFamilies, finalFailures } = await this.retryFailures(
      batch.failures,
    );
    const allFamilies = [...batch.families, ...recoveredFamilies];
    this.logger.log(
      `Phase 1 after retries: parsed=${allFamilies.length} permanently failed=${finalFailures.length}`,
    );

    const rawVariationEntries = allFamilies.reduce(
      (sum, family) => sum + family.variants.length,
      0,
    );

    const { entries, crossFamilyCollisions } =
      this.detectCrossFamilyCollisions(allFamilies);
    const conflictedSkus = new Set(crossFamilyCollisions.map(c => c.sku));
    const observedSkus = new Set(entries.map(e => e.variant.sku));
    const safeEntries = entries.filter(e => !conflictedSkus.has(e.variant.sku));

    this.logger.log(
      `Phase 1 collision detection: distinctSkus=${observedSkus.size} conflicted=${conflictedSkus.size} safe=${safeEntries.length}`,
    );

    this.logger.log('Full Vizaje sync: phase 2 - persisting safe SKUs');

    let inserted = 0;
    let updated = 0;
    let barcodeEnriched = 0;
    const unresolvedCollisions: UnresolvedCollision[] = [];

    const CHUNK_SIZE = 200;
    for (let i = 0; i < safeEntries.length; i += CHUNK_SIZE) {
      const chunk = safeEntries.slice(i, i + CHUNK_SIZE);

      for (const { family, variant } of chunk) {
        const outcome = await this.persistVariant(family, variant);

        if (outcome.kind === 'skipped') {
          unresolvedCollisions.push(outcome.collision);
          continue;
        }

        if (outcome.kind === 'inserted') inserted += 1;
        else updated += 1;

        if (outcome.barcodeEnriched) barcodeEnriched += 1;
      }

      this.logger.log(
        `Phase 2 progress: ${Math.min(i + CHUNK_SIZE, safeEntries.length)}/${safeEntries.length} ` +
          `(inserted=${inserted} updated=${updated} identityUnresolved=${unresolvedCollisions.length})`,
      );
    }

    this.logger.log('Full Vizaje sync: computing legacy-only SKU audit');
    const legacyOnlyAudit = await this.computeLegacyOnlyAudit(observedSkus);

    return {
      familiesDiscovered: batch.discovered,
      familiesParsed: allFamilies.length,
      familiesFailed: finalFailures.length,
      failedFamilies: finalFailures,
      variationEntries: rawVariationEntries,
      distinctSkus: observedSkus.size,
      crossFamilyCollisionCount: crossFamilyCollisions.length,
      crossFamilyCollisions,
      safeSkuCount: safeEntries.length,
      updated,
      inserted,
      barcodeEnriched,
      identityUnresolved: unresolvedCollisions.length,
      unresolvedCollisions,
      legacyOnlyAudit,
      durationMs: Date.now() - startedAt,
    };
  }

  // Small, conservative retry policy for families that failed on the single
  // full-catalog pass. Transient server errors (502/503/504) get up to 3
  // extra attempts with a short backoff; a 404 gets exactly one confirmation
  // attempt (a real 404 is not transient - retrying it 3 times would just be
  // noise). Anything still failing after that is reported and left alone -
  // never treated as "this family's products should be removed/hidden".
  private async retryFailures(failures: VizajeBatchResult['failures']): Promise<{
    recoveredFamilies: ParsedVizajeFamily[];
    finalFailures: FailedFamily[];
  }> {
    const recoveredFamilies: ParsedVizajeFamily[] = [];
    const finalFailures: FailedFamily[] = [];
    const retryDelaysMs = [5_000, 15_000, 30_000];

    for (const failure of failures) {
      const is404 = failure.error.includes('404');
      const maxExtraAttempts = is404 ? 1 : 3;

      let attempts = 1;
      let lastError = failure.error;
      let recovered: ParsedVizajeFamily | null = null;

      for (let i = 0; i < maxExtraAttempts && !recovered; i++) {
        await sleep(retryDelaysMs[i] ?? 30_000);
        attempts += 1;

        try {
          recovered = await this.requestSingleProduct(failure.url);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (recovered) {
        this.logger.log(
          `Recovered family after retry: ${failure.url} (attempts=${attempts})`,
        );
        recoveredFamilies.push(recovered);
      } else {
        finalFailures.push({
          externalId: failure.external_id,
          url: failure.url,
          error: lastError,
          attempts,
          finalOutcome: is404 ? 'failed_stale' : 'failed_transient',
        });
      }
    }

    return { recoveredFamilies, finalFailures };
  }

  private async computeLegacyOnlyAudit(
    observedSkus: Set<string>,
  ): Promise<LegacyOnlyAuditSummary> {
    const rows = await this.database.db
      .select({
        id: products.id,
        sourceId: products.sourceId,
        brand: products.brand,
        category: products.category,
        available: products.available,
        barcode: products.barcode,
      })
      .from(products);

    const legacyOnly = rows.filter(
      row => !row.sourceId || !observedSkus.has(row.sourceId),
    );
    const legacyOnlyIds = new Set(legacyOnly.map(row => row.id));

    const matchRows = await this.database.db
      .select({ productId: matches.productId })
      .from(matches);
    const productsWithMatches = new Set(
      matchRows
        .map(row => row.productId)
        .filter(id => legacyOnlyIds.has(id)),
    );

    const byAvailableStatus = { available: 0, unavailable: 0, unknown: 0 };
    const byHasMatches = { withMatches: 0, withoutMatches: 0 };
    const byHasBarcode = { withBarcode: 0, withoutBarcode: 0 };
    const brandCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();

    for (const row of legacyOnly) {
      if (row.available === true) byAvailableStatus.available += 1;
      else if (row.available === false) byAvailableStatus.unavailable += 1;
      else byAvailableStatus.unknown += 1;

      if (productsWithMatches.has(row.id)) byHasMatches.withMatches += 1;
      else byHasMatches.withoutMatches += 1;

      if (row.barcode) byHasBarcode.withBarcode += 1;
      else byHasBarcode.withoutBarcode += 1;

      const brandKey = row.brand || 'Unknown';
      brandCounts.set(brandKey, (brandCounts.get(brandKey) ?? 0) + 1);

      const categoryKey = row.category || 'Uncategorized';
      categoryCounts.set(categoryKey, (categoryCounts.get(categoryKey) ?? 0) + 1);
    }

    const topBrands = [...brandCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([brand, count]) => ({ brand, count }));

    const topCategories = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([category, count]) => ({ category, count }));

    return {
      totalLegacyOnly: legacyOnly.length,
      byAvailableStatus,
      byHasMatches,
      byHasBarcode,
      topBrands,
      topCategories,
    };
  }

  // The full-catalog batch call takes ~30 minutes and the parser sends
  // nothing back until the whole crawl+parse pass finishes - no headers,
  // no partial body. Both Node's and Bun's built-in fetch() impose an
  // internal idle-socket ceiling around 5 minutes that `AbortSignal.timeout`
  // cannot override (the same class of issue already flagged for OVICO's
  // large batches), so a plain fetch() call reliably dies here. Shelling out
  // to curl sidesteps that entirely - curl has no such default and already
  // proved this exact request works fine (~28.5 min, verified during the
  // dry audit).
  private async requestFullBatchViaCurl(): Promise<VizajeBatchResult> {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        `${this.parserUrl}/parse/vizaje/batch`,
        '-H',
        'Content-Type: application/json',
        '-d',
        '{}',
        '--max-time',
        String(resolveVizajeSyncTimeoutSeconds()),
      ],
      { maxBuffer: 200 * 1024 * 1024 },
    );

    return JSON.parse(stdout) as VizajeBatchResult;
  }

  private async requestSingleProduct(url: string): Promise<ParsedVizajeFamily> {
    const response = await fetch(`${this.parserUrl}/parse/vizaje/product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Parser returned ${response.status}: ${detail}`);
    }

    return (await response.json()) as ParsedVizajeFamily;
  }

  // Pre-pass, run BEFORE any product writes: flattens all families' variants
  // (deduplicating repeated identical sku entries within the SAME family -
  // that's a data-quality quirk, not a collision), then finds any sku that
  // appears under more than one distinct family.external_id in this batch.
  // Those SKUs are reported and excluded from `entries` handling downstream
  // via the caller checking `conflictedSkus`.
  private detectCrossFamilyCollisions(families: ParsedVizajeFamily[]): {
    entries: { family: ParsedVizajeFamily; variant: ParsedVizajeVariant }[];
    crossFamilyCollisions: CrossFamilyCollision[];
  } {
    const entries: { family: ParsedVizajeFamily; variant: ParsedVizajeVariant }[] =
      [];
    const familyInfoBySku = new Map<
      string,
      Map<string, { title: string; url: string }>
    >();

    for (const family of families) {
      const seenSkusInFamily = new Set<string>();

      for (const variant of family.variants) {
        if (seenSkusInFamily.has(variant.sku)) {
          continue;
        }
        seenSkusInFamily.add(variant.sku);
        entries.push({ family, variant });

        if (!familyInfoBySku.has(variant.sku)) {
          familyInfoBySku.set(variant.sku, new Map());
        }
        familyInfoBySku
          .get(variant.sku)!
          .set(family.external_id, {
            title: family.title,
            url: family.canonical_url,
          });
      }
    }

    const crossFamilyCollisions: CrossFamilyCollision[] = [];

    for (const [sku, byFamily] of familyInfoBySku) {
      if (byFamily.size <= 1) continue;

      const familyIds = [...byFamily.keys()];
      crossFamilyCollisions.push({
        sku,
        familyIds,
        familyTitles: familyIds.map(id => byFamily.get(id)!.title),
        urls: familyIds.map(id => byFamily.get(id)!.url),
      });
    }

    return { entries, crossFamilyCollisions };
  }

  private async persistVariant(
    family: ParsedVizajeFamily,
    variant: ParsedVizajeVariant,
  ): Promise<
    | { kind: 'inserted' | 'updated'; barcodeEnriched: boolean }
    | { kind: 'skipped'; collision: UnresolvedCollision }
  > {
    const sku = variant.sku;

    const existingRows = await this.database.db
      .select({
        id: products.id,
        sourceId: products.sourceId,
        sourceKey: products.sourceKey,
        barcode: products.barcode,
        brand: products.brand,
        name: products.name,
        volume: products.volume,
        color: products.color,
      })
      .from(products)
      .where(eq(products.sourceId, sku));

    const resolution = this.barcodeLookup.resolve(sku, {
      brand: family.brand,
      name: family.title,
      volume: variant.volume,
      color: variant.color,
    });

    if (resolution.status === 'ambiguous') {
      return {
        kind: 'skipped',
        collision: {
          sku,
          familyTitle: family.title,
          reason: 'jobvn_ambiguous',
          candidateCount: resolution.candidateGroups,
        },
      };
    }

    let targetRow: ExistingRow | null = null;

    if (existingRows.length === 1) {
      targetRow = existingRows[0]!;
    } else if (existingRows.length > 1) {
      const picked = this.pickBestExistingRow(existingRows, family, variant);

      if (!picked) {
        return {
          kind: 'skipped',
          collision: {
            sku,
            familyTitle: family.title,
            reason: 'existing_rows_ambiguous',
            candidateCount: existingRows.length,
          },
        };
      }

      targetRow = picked;
    }

    const hasEnrichment =
      resolution.status !== 'none' && resolution.allBarcodes.length > 0;

    const sourceKey = targetRow
      ? targetRow.sourceKey
      : resolution.status === 'resolved'
        ? `${sku}:${resolution.barcode}`
        : sku;

    const canonicalBarcode = hasEnrichment
      ? resolution.allBarcodes[0]!
      : (targetRow?.barcode ?? null);

    const values = {
      sourceId: sku,
      sourceKey,
      variantGroupId: family.external_id,
      brand: family.brand ?? 'Unknown',
      name: family.title,
      category: family.category,
      sex: family.sex,
      volume: variant.volume,
      color: variant.color,
      imageUrl: variant.image_url ?? family.image_url,
      price: variant.price != null ? variant.price.toFixed(2) : null,
      regularPrice:
        variant.regular_price != null ? variant.regular_price.toFixed(2) : null,
      url: family.canonical_url,
      available: variant.available,
      barcode: canonicalBarcode,
    };

    const [saved] = await this.database.db
      .insert(products)
      .values(values)
      .onConflictDoUpdate({
        target: products.sourceKey,
        set: {
          variantGroupId: values.variantGroupId,
          brand: values.brand,
          name: values.name,
          category: values.category,
          sex: values.sex,
          volume: values.volume,
          color: values.color,
          imageUrl: values.imageUrl,
          price: values.price,
          regularPrice: values.regularPrice,
          url: values.url,
          available: values.available,
          barcode: values.barcode,
          updatedAt: new Date(),
        },
      })
      .returning({ id: products.id });

    if (hasEnrichment) {
      for (const barcode of resolution.allBarcodes) {
        await this.database.db
          .insert(productBarcodes)
          .values({ productId: saved!.id, barcode })
          .onConflictDoUpdate({
            target: productBarcodes.barcode,
            set: { productId: saved!.id },
          });
      }
    }

    return {
      kind: targetRow ? 'updated' : 'inserted',
      barcodeEnriched: hasEnrichment,
    };
  }

  // Rare path: multiple existing products rows already share this sourceId
  // (a collision the legacy JSON importer resolved into separate rows).
  // Pick the one whose stored brand/name/volume/color best matches this
  // website variant; skip (report) if it can't be told apart confidently.
  private pickBestExistingRow(
    rows: ExistingRow[],
    family: ParsedVizajeFamily,
    variant: ParsedVizajeVariant,
  ): ExistingRow | null {
    if (!family.brand) return null;

    const scored = rows
      .map(row => {
        if (canonicalBrand(row.brand) !== canonicalBrand(family.brand)) {
          return null;
        }

        const rowVolume = normalizeVolume(row.volume);
        const webVolume = normalizeVolume(variant.volume);
        if (rowVolume && webVolume && !volumesMatch(rowVolume, webVolume)) {
          return null;
        }

        const rowColor = (row.color ?? '').trim();
        const webColor = (variant.color ?? '').trim();
        if (rowColor && webColor && rowColor !== webColor) return null;

        let score = nameSimilarity(
          normalizeName(row.name),
          normalizeName(family.title),
        );

        if (rowVolume && webVolume && volumesMatch(rowVolume, webVolume)) {
          score += 0.5;
        }
        if (rowColor && webColor && rowColor === webColor) score += 0.5;

        return { row, score };
      })
      .filter((entry): entry is { row: ExistingRow; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    const second = scored[1];

    if (top && top.score >= 0.3 && (!second || top.score - second.score >= 0.15)) {
      return top.row;
    }

    return null;
  }

  private async requestBatch(
    maxProducts: number | undefined,
    timeoutMs: number = 5 * 60 * 1000,
  ): Promise<VizajeBatchResult> {
    let response: Response;

    try {
      response = await fetch(`${this.parserUrl}/parse/vizaje/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_products: maxProducts }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BadGatewayException(
        `Failed to reach parser service: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new BadGatewayException(
        `Parser service returned ${response.status}: ${detail}`,
      );
    }

    return (await response.json()) as VizajeBatchResult;
  }
}
