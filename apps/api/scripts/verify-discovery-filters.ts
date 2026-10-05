import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  competitorProducts,
  competitorProductVariants,
  competitors,
  eq,
  ilike,
  matches,
  products,
} from '@price/db';

import { AppModule } from '../src/app.module';
import { selectDiscoveryTargets } from '../src/competitors/discovery-targets';
import { DatabaseService } from '../src/database/database.service';

// Integration-level verification for the filtered discovery selection
// milestone (brand / in-stock / only-unmatched flags) - matches the
// project's existing verify-*.ts convention (real NestJS services, real dev
// DB) rather than mocking Drizzle. Inserts a small set of synthetic
// products/matches under a distinctive sourceKey prefix, runs
// selectDiscoveryTargets() against them directly, and deletes everything it
// created in a finally block regardless of pass/fail.
//
// Run with (from apps/api): bun run scripts/verify-discovery-filters.ts

const SOURCE_KEY_PREFIX = 'test-discovery-filter-';
const BRAND_A = 'ZZZ Test Discovery Brand A';
const BRAND_B = 'ZZZ Test Discovery Brand B';

let failures = 0;

function check(label: string, condition: boolean): void {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${label}`);
  if (!condition) failures += 1;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const database = app.get(DatabaseService);
  const insertedProductIds: number[] = [];

  try {
    // --- Fixture setup ---------------------------------------------------
    // P1: brand A, in stock, unmatched           -> the one row every
    //     "brand A + in-stock + unmatched" combination should resolve to.
    // P2: brand A, OUT of stock, unmatched        -> excluded by --in-stock.
    // P3: brand B, in stock, unmatched             -> excluded by --brand.
    // P4: brand A, in stock, MATCHED on makeup.md  -> excluded by
    //     --only-unmatched for makeup, but still eligible for ovico
    //     (competitor-specific exclusion).
    // P5: brand A, in stock, NO url (not website-confirmed) -> never
    //     eligible for anything, baseline sanity check.
    const [p1, p2, p3, p4, p5] = await database.db
      .insert(products)
      .values([
        {
          sourceKey: `${SOURCE_KEY_PREFIX}p1`,
          brand: BRAND_A,
          name: 'Test Product P1 (brand A, in stock, unmatched)',
          url: 'https://vizaje-nica.md/test/p1',
          available: true,
        },
        {
          sourceKey: `${SOURCE_KEY_PREFIX}p2`,
          brand: BRAND_A,
          name: 'Test Product P2 (brand A, out of stock, unmatched)',
          url: 'https://vizaje-nica.md/test/p2',
          available: false,
        },
        {
          sourceKey: `${SOURCE_KEY_PREFIX}p3`,
          brand: BRAND_B,
          name: 'Test Product P3 (brand B, in stock, unmatched)',
          url: 'https://vizaje-nica.md/test/p3',
          available: true,
        },
        {
          sourceKey: `${SOURCE_KEY_PREFIX}p4`,
          brand: BRAND_A,
          name: 'Test Product P4 (brand A, in stock, matched on makeup.md)',
          url: 'https://vizaje-nica.md/test/p4',
          available: true,
        },
        {
          sourceKey: `${SOURCE_KEY_PREFIX}p5`,
          brand: BRAND_A,
          name: 'Test Product P5 (brand A, in stock, no url)',
          url: null,
          available: true,
        },
      ])
      .returning({ id: products.id });

    insertedProductIds.push(p1.id, p2.id, p3.id, p4.id, p5.id);

    // Synthetic MAKEUP match for P4 only.
    const [makeupCompetitor] = await database.db
      .insert(competitors)
      .values({ name: 'MAKEUP', domain: 'makeup.md' })
      .onConflictDoNothing({ target: competitors.domain })
      .returning({ id: competitors.id });

    const makeupCompetitorId =
      makeupCompetitor?.id ??
      (
        await database.db
          .select({ id: competitors.id })
          .from(competitors)
          .where(eq(competitors.domain, 'makeup.md'))
      )[0]!.id;

    const [competitorProduct] = await database.db
      .insert(competitorProducts)
      .values({
        competitorId: makeupCompetitorId,
        externalId: `${SOURCE_KEY_PREFIX}p4-external`,
        title: 'Synthetic MAKEUP product for P4',
        url: 'https://makeup.md/test/p4',
      })
      .returning({ id: competitorProducts.id });

    const [competitorVariant] = await database.db
      .insert(competitorProductVariants)
      .values({
        competitorProductId: competitorProduct!.id,
        externalId: `${SOURCE_KEY_PREFIX}p4-variant`,
        label: '50 ml',
      })
      .returning({ id: competitorProductVariants.id });

    await database.db.insert(matches).values({
      productId: p4.id,
      competitorProductVariantId: competitorVariant!.id,
      source: 'auto',
      score: 100,
    });

    // --- Tests -------------------------------------------------------------

    console.log('=== brand filter ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        productIds: undefined,
        brand: BRAND_A,
        limit: 100,
      });
      const ids = selection.targets.map(t => t.id);
      check('only brand-A, unmatched-on-makeup products are selected', ids.includes(p1.id) && !ids.includes(p3.id) && !ids.includes(p4.id) && !ids.includes(p5.id));
      check('filters.brand echoes the requested brand', selection.filters.brand === BRAND_A);
      check('usedRotation is false for a filtered call', selection.usedRotation === false);
    }

    console.log('=== case-insensitive brand input ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A.toLowerCase(),
        limit: 100,
      });
      const ids = selection.targets.map(t => t.id);
      check('lowercase brand input matches the same pool as the stored casing', ids.includes(p1.id) && !ids.includes(p3.id));
    }

    console.log('=== in-stock filtering ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        inStock: true,
        limit: 100,
      });
      const ids = selection.targets.map(t => t.id);
      check('in-stock excludes the out-of-stock brand-A product (P2)', ids.includes(p1.id) && !ids.includes(p2.id));
    }

    console.log('=== only-unmatched exclusion ===');
    {
      const withOnlyUnmatched = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        onlyUnmatched: true,
        limit: 100,
      });
      const withoutOnlyUnmatched = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        onlyUnmatched: false,
        limit: 100,
      });

      check(
        'onlyUnmatched=true excludes the already-matched-on-makeup product (P4)',
        !withOnlyUnmatched.targets.map(t => t.id).includes(p4.id),
      );
      check(
        'onlyUnmatched=false allows the already-matched product (P4) back into the pool',
        withoutOnlyUnmatched.targets.map(t => t.id).includes(p4.id),
      );
    }

    console.log('=== competitor-specific exclusion (makeup match must not exclude ovico discovery, and vice versa) ===');
    {
      const makeupSelection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        onlyUnmatched: true,
        limit: 100,
      });
      const ovicoSelection = await selectDiscoveryTargets(database, 'ovico.md', 'test-ovico-discovery', 20, {
        brand: BRAND_A,
        onlyUnmatched: true,
        limit: 100,
      });

      check('P4 (matched on makeup.md only) is excluded from MAKEUP discovery', !makeupSelection.targets.map(t => t.id).includes(p4.id));
      check('P4 (matched on makeup.md only) is still eligible for OVICO discovery', ovicoSelection.targets.map(t => t.id).includes(p4.id));
    }

    console.log('=== combined filters (brand + in-stock + only-unmatched) ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        inStock: true,
        onlyUnmatched: true,
        limit: 100,
      });
      const ids = selection.targets.map(t => t.id).sort();
      check('combined filters resolve to exactly {P1}', ids.length === 1 && ids[0] === p1.id);
      check('eligibleProducts matches the actual pool size (1)', selection.eligibleProducts === 1);
    }

    console.log('=== limit > eligible pool ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery', 20, {
        brand: BRAND_A,
        inStock: true,
        onlyUnmatched: true,
        limit: 9999,
      });
      check('does not throw / does not duplicate when limit exceeds the eligible pool', selection.targets.length === selection.eligibleProducts);
      check('eligibleProducts still reports the true (small) pool size', selection.eligibleProducts === 1);
    }

    console.log('=== unfiltered call preserves legacy rotation behavior ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', 'test-makeup-discovery-rotation-smoke', 5, {});
      check('usedRotation is true when no filters are passed', selection.usedRotation === true);
      check('filters report the unfiltered defaults', selection.filters.brand === null && selection.filters.inStock === false && selection.filters.onlyUnmatched === true);
    }

    console.log();
    if (failures > 0) {
      console.log(`${failures} assertion(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('All assertions PASSED');
    }
  } finally {
    // Cleanup, independent of pass/fail - delete the synthetic match first
    // (FK), then the synthetic competitor rows, then the synthetic products.
    // Matched by sourceKey/externalId prefix as a safety net in case the
    // insertedProductIds list above is incomplete (e.g. an early throw).
    await database.db.delete(matches).where(
      eq(matches.productId, insertedProductIds[3] ?? -1),
    );
    await database.db.delete(competitorProductVariants).where(ilike(competitorProductVariants.externalId, `${SOURCE_KEY_PREFIX}%`));
    await database.db.delete(competitorProducts).where(ilike(competitorProducts.externalId, `${SOURCE_KEY_PREFIX}%`));
    await database.db.delete(products).where(ilike(products.sourceKey, `${SOURCE_KEY_PREFIX}%`));

    await app.close();
  }
}

main()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch(error => {
    console.error('[verify-discovery-filters] FAILED', error);
    process.exit(1);
  });
