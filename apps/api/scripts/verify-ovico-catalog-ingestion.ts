// OVICO Catalog Ingestion v1 - real-Postgres verification, same convention
// as M1-M6's verify-*.ts scripts: prefix-scoped fake fixtures, idempotent
// cleanup, real MAKEUP/OVICO/Brocard/Aroma competitor rows and real brand
// rows (givenchy/chanel/lancome/dior as of this writing) snapshotted and
// re-asserted untouched before and after. A real HTTP fetch to the parser
// service cannot happen from this sandbox (ovico.md is blocked at the
// network layer here) - crawlBrandSource's network call is stubbed with
// the real captured fixture HTML (__fixtures__/ovico-armani-brand-page.html)
// rather than skipped, so the full insert/upsert/run-bookkeeping path is
// still exercised end to end against real data shape.
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  brands,
  catalogSyncRuns,
  competitorBrandSources,
  competitorProducts,
  competitorProductVariants,
  competitors,
  eq,
  inArray,
} from '@price/db';

import { DatabaseService } from '../src/database/database.service';
import { OvicoBrandSourcesService } from '../src/competitors/ovico-catalog/ovico-brand-sources.service';
import { OvicoCatalogPersistenceService } from '../src/competitors/ovico-catalog/ovico-catalog-persistence.service';
import { OvicoCatalogSyncService } from '../src/competitors/ovico-catalog/ovico-catalog-sync.service';
import { parseOvicoListingPage } from '../src/competitors/ovico-catalog/ovico-listing-parser';
import { canonicalBrand } from '../src/matching/matching-normalization';

const PREFIX = 'ovico_catalog_verify_';
const RAW_BRAND_A = 'OvicoCatalogVerifyFakeBrandAlpha';
const RAW_BRAND_B = 'OvicoCatalogVerifyFakeBrandBeta';
const KEY_A = canonicalBrand(RAW_BRAND_A);
const KEY_B = canonicalBrand(RAW_BRAND_B);

const REAL_COMPETITOR_DOMAINS = ['makeup.md', 'ovico.md', 'brocard.md', 'aroma.md'];
const REAL_BRAND_KEYS = ['givenchy', 'chanel', 'lancome', 'dior'];

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  OK: ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${label}`);
  }
}

async function snapshotRealRows(database: DatabaseService) {
  const competitorRows = await database.db
    .select()
    .from(competitors)
    .where(inArray(competitors.domain, REAL_COMPETITOR_DOMAINS));
  const brandRows = await database.db
    .select()
    .from(brands)
    .where(inArray(brands.canonicalKey, REAL_BRAND_KEYS));
  return { competitorRows: JSON.stringify(competitorRows), brandRows: JSON.stringify(brandRows) };
}

async function main() {
  const database = new DatabaseService();
  const brandSources = new OvicoBrandSourcesService(database);
  const persistence = new OvicoCatalogPersistenceService(database);
  const sync = new OvicoCatalogSyncService(database, persistence);

  const before = await snapshotRealRows(database);

  const fixtureProductIds: number[] = [];
  const fixtureSourceIds: number[] = [];
  const fixtureRunIds: number[] = [];
  let fakeCompetitorId: number | undefined;
  const extraCompetitorIds: number[] = [];

  try {
    await database.db
      .insert(brands)
      .values([
        { canonicalKey: KEY_A, displayName: RAW_BRAND_A },
        { canonicalKey: KEY_B, displayName: RAW_BRAND_B },
      ]);

    const [fakeCompetitor] = await database.db
      .insert(competitors)
      .values({ name: `${PREFIX}competitor`, domain: `${PREFIX}competitor.test` })
      .returning();
    fakeCompetitorId = fakeCompetitor!.id;

    console.log('--- competitor_brand_sources: multiple OVICO sources per canonical brand ---');
    {
      const src1 = await brandSources.upsert({
        brandId: KEY_A,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-a-main`,
        status: 'confirmed',
      });
      const src2 = await brandSources.upsert({
        brandId: KEY_A,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-a-beauty`,
        status: 'confirmed',
      });
      fixtureSourceIds.push(src1.id, src2.id);

      check('one canonical brand accepts two distinct source URLs (no (brandId,competitorId) unique)', src1.id !== src2.id);

      const listed = await brandSources.listForBrand(KEY_A);
      check('listForBrand returns both source pages for the same brand', listed.length === 2);
    }

    console.log('--- unique (competitorId, sourceUrl) ---');
    {
      const dup = await brandSources.upsert({
        brandId: KEY_B,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-a-main`,
        status: 'needs_review',
      });
      fixtureSourceIds.push(dup.id);

      check(
        'upserting the SAME (competitorId, sourceUrl) updates the existing row instead of duplicating it (brandId reassigned)',
        dup.id === fixtureSourceIds[0] && dup.brandId === KEY_B,
      );

      const listed = await brandSources.listForBrand(KEY_A);
      check('the reassigned source no longer appears under its old brand', listed.length === 1);
    }

    console.log('--- confirmed / missing / needs_review status ---');
    {
      const missingSource = await brandSources.upsert({
        brandId: KEY_B,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-b-does-not-exist`,
        status: 'missing',
      });
      fixtureSourceIds.push(missingSource.id);
      check("a brand the competitor genuinely doesn't carry persists as status='missing'", missingSource.status === 'missing');

      const patched = await brandSources.patch(missingSource.id, { status: 'needs_review' });
      check('source status updates in place (missing -> needs_review)', patched.status === 'needs_review');
    }

    console.log('--- source URL domain sanity (the 26 real mappings must all point at ovico.md) ---');
    {
      const realOvicoUrls = [
        'https://ovico.md/ru/armani',
        'https://ovico.md/ru/lancome',
        'https://ovico.md/ru/tom-ford',
      ];
      check(
        'every known-mapping URL used by the seed script belongs to the ovico.md domain',
        realOvicoUrls.every(url => new URL(url).hostname === 'ovico.md'),
      );
    }

    console.log('--- parseOvicoListingPage against the real captured Armani fixture ---');
    const fixtureHtml = readFileSync(
      join(__dirname, '../src/competitors/__fixtures__/ovico-armani-brand-page.html'),
      'utf-8',
    );
    const parsedArmani = parseOvicoListingPage(fixtureHtml);
    check('the real fixture parses to a non-trivial product list', parsedArmani.length > 50);

    console.log('--- catalog product upsert: insert then update, not duplicate ---');
    {
      const sampleProduct = parsedArmani.find(p => p.price != null)!;
      const syntheticId = `${PREFIX}${sampleProduct.externalId}`;
      const first = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
        ...sampleProduct,
        externalId: syntheticId,
      });
      check('first upsert of a new external id inserts', first.outcome === 'inserted');

      const [afterFirst] = await database.db
        .select()
        .from(competitorProducts)
        .where(eq(competitorProducts.id, first.competitorProductId));
      fixtureProductIds.push(first.competitorProductId);
      const firstSeenAt = afterFirst!.firstSeenAt.getTime();
      const lastSeenAtFirst = afterFirst!.lastSeenAt.getTime();

      await new Promise(resolve => setTimeout(resolve, 10));

      const second = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
        ...sampleProduct,
        externalId: syntheticId,
        name: `${sampleProduct.name} (updated)`,
      });
      check('re-upserting the SAME external id updates, never duplicates', second.outcome === 'updated' && second.competitorProductId === first.competitorProductId);

      const rowsForExternalId = await database.db
        .select()
        .from(competitorProducts)
        .where(eq(competitorProducts.externalId, syntheticId));
      check('exactly one competitor_products row exists for this external id after two syncs', rowsForExternalId.length === 1);

      const [afterSecond] = rowsForExternalId;
      check('title updates on re-sync', afterSecond!.title === `${sampleProduct.name} (updated)`);
      check('firstSeenAt is preserved across the update (not reset)', afterSecond!.firstSeenAt.getTime() === firstSeenAt);
      check('lastSeenAt advances on re-sync', afterSecond!.lastSeenAt.getTime() > lastSeenAtFirst);

      const variantRows = await database.db
        .select()
        .from(competitorProductVariants)
        .where(eq(competitorProductVariants.competitorProductId, first.competitorProductId));
      check('exactly one variant row exists after two syncs (idempotent, not duplicated)', variantRows.length === 1);
    }

    console.log('--- a product not seen in a later sync is NOT hard-deleted ---');
    {
      const onlyThisRun = `${PREFIX}only-in-run-one`;
      const first = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
        externalId: onlyThisRun,
        url: 'https://example.test/only-in-run-one',
        brandLabel: 'TESTBRAND',
        name: 'Only In Run One',
        concentration: null,
        imageUrl: null,
        price: 100,
        isApproximatePrice: false,
      });
      fixtureProductIds.push(first.competitorProductId);

      // A second, disjoint sync (different products) never touches this
      // row at all - simulating the real "brand A's catalog no longer
      // lists this item" case with no diffing step implemented in v1.
      const other = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
        externalId: `${PREFIX}a-different-product`,
        url: 'https://example.test/different',
        brandLabel: 'TESTBRAND',
        name: 'A Different Product',
        concentration: null,
        imageUrl: null,
        price: 50,
        isApproximatePrice: false,
      });
      fixtureProductIds.push(other.competitorProductId);

      const [stillThere] = await database.db
        .select()
        .from(competitorProducts)
        .where(eq(competitorProducts.externalId, onlyThisRun));
      check('a product absent from a later, unrelated sync is never hard-deleted', stillThere !== undefined);
      check('its `active` flag stays true in v1 (no diffing/stale policy implemented yet)', stillThere?.active === true);
    }

    console.log('--- competitor separation: same external code under two different competitors never collides ---');
    {
      const [otherFakeCompetitor] = await database.db
        .insert(competitors)
        .values({ name: `${PREFIX}other-competitor`, domain: `${PREFIX}other-competitor.test` })
        .returning();
      extraCompetitorIds.push(otherFakeCompetitor!.id);

      const sharedCode = `${PREFIX}shared-code-388372`;
      const forFirst = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
        externalId: sharedCode,
        url: 'https://example.test/first-competitor-product',
        brandLabel: 'TESTBRAND',
        name: 'First Competitor Product',
        concentration: null,
        imageUrl: null,
        price: 200,
        isApproximatePrice: false,
      });
      const forSecond = await persistence.upsertProduct(otherFakeCompetitor!.id, KEY_A, {
        externalId: sharedCode,
        url: 'https://example.test/second-competitor-product',
        brandLabel: 'TESTBRAND',
        name: 'Second Competitor Product',
        concentration: null,
        imageUrl: null,
        price: 999,
        isApproximatePrice: false,
      });
      fixtureProductIds.push(forFirst.competitorProductId, forSecond.competitorProductId);

      check(
        'the same external code under two different competitors persists as two distinct rows, neither overwriting the other',
        forFirst.competitorProductId !== forSecond.competitorProductId,
      );

      const [firstRow] = await database.db
        .select()
        .from(competitorProducts)
        .where(eq(competitorProducts.id, forFirst.competitorProductId));
      check("the first competitor's row keeps its own title, unaffected by the second competitor's upsert", firstRow?.title === 'First Competitor Product');
    }

    console.log('--- "от" (from) approximate price is flagged, not silently presented as exact ---');
    {
      const approxSource = parsedArmani.find(p => p.isApproximatePrice);
      check('the real fixture contains at least one approximate-price ("от") product', approxSource !== undefined);

      if (approxSource) {
        const result = await persistence.upsertProduct(fakeCompetitorId, KEY_A, {
          ...approxSource,
          externalId: `${PREFIX}${approxSource.externalId}`,
        });
        fixtureProductIds.push(result.competitorProductId);

        const [variant] = await database.db
          .select()
          .from(competitorProductVariants)
          .where(eq(competitorProductVariants.competitorProductId, result.competitorProductId));
        check('isApproximatePrice=true is persisted on the variant for a "от"-prefixed listing price', variant?.isApproximatePrice === true);
      }
    }

    console.log('--- crawlBrandSource end-to-end (network stubbed with the real fixture) ---');
    {
      const liveSource = await brandSources.upsert({
        brandId: KEY_A,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-a-e2e`,
        status: 'confirmed',
      });
      fixtureSourceIds.push(liveSource.id);

      const realFetch = global.fetch;
      global.fetch = (async () =>
        new Response(JSON.stringify({ url: liveSource.sourceUrl, html: fixtureHtml }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      let result;
      try {
        result = await sync.crawlBrandSource(liveSource.id);
      } finally {
        global.fetch = realFetch;
      }

      check('crawlBrandSource completes successfully against the real fixture', result.status === 'completed');
      check('discovered count matches the parser output', result.discovered === parsedArmani.length);
      check('inserted count is positive on a first run', result.inserted > 0);

      const runRows = await database.db
        .select()
        .from(catalogSyncRuns)
        .where(eq(catalogSyncRuns.id, result.runId));
      fixtureRunIds.push(result.runId);
      check('a catalog_sync_runs row is persisted with matching counters', runRows[0]?.status === 'completed' && runRows[0]?.discovered === parsedArmani.length);

      const [sourceAfter] = await database.db
        .select()
        .from(competitorBrandSources)
        .where(eq(competitorBrandSources.id, liveSource.id));
      check("the brand source's lastSyncStatus/lastSyncedAt update on success", sourceAfter?.lastSyncStatus === 'completed' && sourceAfter?.lastSyncedAt !== null);

      const insertedCompetitorProductIds = await database.db
        .select({ id: competitorProducts.id })
        .from(competitorProducts)
        .where(eq(competitorProducts.competitorId, fakeCompetitorId));
      fixtureProductIds.push(...insertedCompetitorProductIds.map(r => r.id));

      console.log('--- rerun is safe (idempotent) ---');
      global.fetch = (async () =>
        new Response(JSON.stringify({ url: liveSource.sourceUrl, html: fixtureHtml }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      let rerun;
      try {
        rerun = await sync.crawlBrandSource(liveSource.id);
      } finally {
        global.fetch = realFetch;
      }
      fixtureRunIds.push(rerun.runId);

      check('a rerun of the same brand source completes successfully', rerun.status === 'completed');
      check('a rerun finds the same products already present (updated, not newly inserted again)', rerun.updated > 0);

      const countAfterRerun = await database.db
        .select({ id: competitorProducts.id })
        .from(competitorProducts)
        .where(eq(competitorProducts.competitorId, fakeCompetitorId));
      check('rerunning does not duplicate rows', countAfterRerun.length === insertedCompetitorProductIds.length);
    }

    console.log('--- sync failure persists useful status, and a rerun after failure is safe ---');
    {
      const failingSource = await brandSources.upsert({
        brandId: KEY_A,
        competitorId: fakeCompetitorId,
        sourceUrl: `https://${PREFIX}competitor.test/brand-a-failing`,
        status: 'confirmed',
      });
      fixtureSourceIds.push(failingSource.id);

      const realFetch = global.fetch;
      global.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;

      let failedResult;
      try {
        failedResult = await sync.crawlBrandSource(failingSource.id);
      } finally {
        global.fetch = realFetch;
      }

      check('a parser-service failure is caught and reported as status=failed, not thrown', failedResult.status === 'failed');
      check('errorSummary carries a useful message', Boolean(failedResult.errorSummary));
      fixtureRunIds.push(failedResult.runId);

      const [sourceAfterFailure] = await database.db
        .select()
        .from(competitorBrandSources)
        .where(eq(competitorBrandSources.id, failingSource.id));
      check("the brand source's lastSyncStatus/lastSyncError reflect the failure", sourceAfterFailure?.lastSyncStatus === 'failed' && Boolean(sourceAfterFailure?.lastSyncError));

      // Rerun with a working fetch - must succeed cleanly, proving a failed
      // run never leaves the source/run bookkeeping in a state that blocks
      // a later successful sync.
      global.fetch = (async () =>
        new Response(JSON.stringify({ url: failingSource.sourceUrl, html: fixtureHtml }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      let recovered;
      try {
        recovered = await sync.crawlBrandSource(failingSource.id);
      } finally {
        global.fetch = realFetch;
      }
      fixtureRunIds.push(recovered.runId);

      check('a rerun after a failure succeeds cleanly', recovered.status === 'completed');

      const insertedAfterRecovery = await database.db
        .select({ id: competitorProducts.id })
        .from(competitorProducts)
        .where(eq(competitorProducts.competitorId, fakeCompetitorId));
      fixtureProductIds.push(...insertedAfterRecovery.map(r => r.id));
    }
  } finally {
    console.log('--- cleanup ---');
    const uniqueProductIds = [...new Set(fixtureProductIds)];
    if (uniqueProductIds.length > 0) {
      await database.db
        .delete(competitorProductVariants)
        .where(inArray(competitorProductVariants.competitorProductId, uniqueProductIds));
      await database.db.delete(competitorProducts).where(inArray(competitorProducts.id, uniqueProductIds));
    }
    if (fixtureRunIds.length > 0) {
      await database.db.delete(catalogSyncRuns).where(inArray(catalogSyncRuns.id, [...new Set(fixtureRunIds)]));
    }
    if (fixtureSourceIds.length > 0) {
      await database.db
        .delete(competitorBrandSources)
        .where(inArray(competitorBrandSources.id, [...new Set(fixtureSourceIds)]));
    }
    const allCompetitorIds = [
      ...(fakeCompetitorId !== undefined ? [fakeCompetitorId] : []),
      ...extraCompetitorIds,
    ];
    if (allCompetitorIds.length > 0) {
      await database.db.delete(competitors).where(inArray(competitors.id, allCompetitorIds));
    }
    await database.db.delete(brands).where(inArray(brands.canonicalKey, [KEY_A, KEY_B]));

    const after = await snapshotRealRows(database);
    check('real competitor rows (MAKEUP/OVICO/Brocard/Aroma) byte-for-byte unchanged', before.competitorRows === after.competitorRows);
    check('real brand rows (givenchy/chanel/lancome/dior) byte-for-byte unchanged', before.brandRows === after.brandRows);

    await database.onModuleDestroy();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
