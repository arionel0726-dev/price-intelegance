// Standalone regression check for the variant-safe competitorPrice pairing
// in ProductsService.findAll() (GET /products). NOT a jest suite - the
// repo's existing jest config currently fails on every spec file with a
// pre-existing, unrelated TS5011 rootDir error (`bun run --filter=api test`
// reproduces it against src/app.controller.spec.ts and the other existing
// specs, none of which this change touches). This script is a real,
// runnable substitute: it inserts a small set of self-contained fixture
// rows (all tagged ZZTESTFIX so they can never collide with real catalog
// data), calls the actual service, asserts the exact expected
// price/competitorPrice pairing, then deletes everything it inserted.
//
// Usage (from apps/api): bun run scripts/verify-catalog-price-safety.ts

import 'reflect-metadata';

import {
  competitorProductVariants,
  competitorProducts,
  competitors,
  eq,
  inArray,
  matches,
  products,
} from '@price/db';

import { DatabaseService } from '../src/database/database.service';
import { ProductsService } from '../src/products/products.service';

const MARK = 'ZZTESTFIX';

async function main() {
  const database = new DatabaseService();
  const service = new ProductsService(database);
  const db = database.db;

  let failures = 0;

  function assertEqual(label: string, actual: unknown, expected: unknown) {
    const pass = actual === expected;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    if (!pass) failures += 1;
  }

  console.log('Seeding fixtures...');

  const [competitor] = await db
    .insert(competitors)
    .values({ name: `${MARK} Competitor`, domain: 'testfix.invalid' })
    .returning({ id: competitors.id });

  async function insertCompetitorOffer(externalId: string, price: string) {
    const [cp] = await db
      .insert(competitorProducts)
      .values({
        competitorId: competitor!.id,
        externalId,
        title: `${MARK} offer ${externalId}`,
        url: `https://testfix.invalid/${externalId}`,
      })
      .returning({ id: competitorProducts.id });

    const [cpv] = await db
      .insert(competitorProductVariants)
      .values({ competitorProductId: cp!.id, externalId, price })
      .returning({ id: competitorProductVariants.id });

    return cpv!.id;
  }

  async function insertVizajeProduct(opts: {
    sourceKey: string;
    name: string;
    variantGroupId?: string;
    volume?: string;
    color?: string;
    price: string;
  }) {
    const [row] = await db
      .insert(products)
      .values({
        sourceId: opts.sourceKey,
        sourceKey: opts.sourceKey,
        variantGroupId: opts.variantGroupId,
        brand: MARK,
        name: `${MARK} ${opts.name}`,
        volume: opts.volume,
        color: opts.color,
        price: opts.price,
        url: `https://vizaje-nica.com/testfix/${opts.sourceKey}`,
      })
      .returning({ id: products.id });

    return row!.id;
  }

  async function match(productId: number, competitorVariantId: number) {
    await db.insert(matches).values({
      productId,
      competitorProductVariantId: competitorVariantId,
      source: 'auto',
      score: 90,
    });
  }

  // 1. Standalone product with a competitor match.
  const standaloneId = await insertVizajeProduct({
    sourceKey: `${MARK}-standalone`,
    name: 'Standalone',
    price: '1000.00',
  });
  await match(standaloneId, await insertCompetitorOffer('standalone', '900.00'));

  // 2. Family (2 volumes) where the MIN-price variant is the matched one.
  const sameVolMinId = await insertVizajeProduct({
    sourceKey: `${MARK}-samevol-30`,
    name: 'SameVolFamily',
    variantGroupId: `${MARK}-samevol`,
    volume: '30',
    price: '900.00',
  });
  await insertVizajeProduct({
    sourceKey: `${MARK}-samevol-50`,
    name: 'SameVolFamily',
    variantGroupId: `${MARK}-samevol`,
    volume: '50',
    price: '1700.00',
  });
  await match(sameVolMinId, await insertCompetitorOffer('samevol', '800.00'));

  // 3. Family where the competitor exists ONLY for a different (pricier)
  // volume than the one that produces product.price - the exact bug.
  const crossVolMinId = await insertVizajeProduct({
    sourceKey: `${MARK}-crossvol-30`,
    name: 'CrossVolFamily',
    variantGroupId: `${MARK}-crossvol`,
    volume: '30',
    price: '900.00',
  });
  const crossVolOtherId = await insertVizajeProduct({
    sourceKey: `${MARK}-crossvol-100`,
    name: 'CrossVolFamily',
    variantGroupId: `${MARK}-crossvol`,
    volume: '100',
    price: '1700.00',
  });
  await match(crossVolOtherId, await insertCompetitorOffer('crossvol', '1500.00'));

  // 4. Shade family, match exists only on a non-min-price shade.
  const shadeMinId = await insertVizajeProduct({
    sourceKey: `${MARK}-shade-01`,
    name: 'ShadeFamily',
    variantGroupId: `${MARK}-shade`,
    color: '01',
    price: '500.00',
  });
  const shadeOtherId = await insertVizajeProduct({
    sourceKey: `${MARK}-shade-02`,
    name: 'ShadeFamily',
    variantGroupId: `${MARK}-shade`,
    color: '02',
    price: '600.00',
  });
  await match(shadeOtherId, await insertCompetitorOffer('shade', '550.00'));

  // 5. No competitor at all.
  const noCompetitorId = await insertVizajeProduct({
    sourceKey: `${MARK}-nocompetitor`,
    name: 'NoCompetitor',
    price: '1000.00',
  });

  // 6. Equal prices.
  const equalId = await insertVizajeProduct({
    sourceKey: `${MARK}-equal`,
    name: 'EqualPrice',
    price: '1000.00',
  });
  await match(equalId, await insertCompetitorOffer('equal', '1000.00'));

  // 7. Multiple competitor offers on the same standalone product.
  const multiId = await insertVizajeProduct({
    sourceKey: `${MARK}-multi`,
    name: 'MultiCompetitor',
    price: '1000.00',
  });
  await match(multiId, await insertCompetitorOffer('multi-a', '950.00'));
  await match(multiId, await insertCompetitorOffer('multi-b', '1200.00'));

  console.log('Running ProductsService.findAll()...');
  const result = await service.findAll({ search: MARK, limit: 50 });
  const byId = new Map(result.items.map(item => [item.id, item]));

  console.log('\nAsserting...');

  assertEqual('standalone.price', byId.get(standaloneId)?.price, '1000.00');
  assertEqual('standalone.competitorPrice', byId.get(standaloneId)?.competitorPrice, '900.00');

  assertEqual('sameVolFamily.price (min of 900/1700)', byId.get(sameVolMinId)?.price, '900.00');
  assertEqual(
    'sameVolFamily.competitorPrice (min-price SKU IS matched)',
    byId.get(sameVolMinId)?.competitorPrice,
    '800.00',
  );

  assertEqual('crossVolFamily.price (min of 900/1700)', byId.get(crossVolMinId)?.price, '900.00');
  assertEqual(
    'crossVolFamily.competitorPrice (match belongs to the OTHER volume - must be null, not 1500)',
    byId.get(crossVolMinId)?.competitorPrice,
    null,
  );

  assertEqual('shadeFamily.price (min of 500/600)', byId.get(shadeMinId)?.price, '500.00');
  assertEqual(
    'shadeFamily.competitorPrice (match belongs to the OTHER shade - must be null, not 550)',
    byId.get(shadeMinId)?.competitorPrice,
    null,
  );

  assertEqual('noCompetitor.competitorPrice', byId.get(noCompetitorId)?.competitorPrice, null);

  assertEqual('equalPrice.price', byId.get(equalId)?.price, '1000.00');
  assertEqual('equalPrice.competitorPrice', byId.get(equalId)?.competitorPrice, '1000.00');

  assertEqual(
    'multiCompetitor.competitorPrice (min of 950/1200)',
    byId.get(multiId)?.competitorPrice,
    '950.00',
  );

  console.log('\nCleaning up fixtures...');

  const fixtureProductIds = [
    standaloneId,
    sameVolMinId,
    crossVolMinId,
    crossVolOtherId,
    shadeMinId,
    shadeOtherId,
    noCompetitorId,
    equalId,
    multiId,
  ];
  // sameVolFamily's non-min sibling (50ml) was never captured in a variable
  // - re-select it by variant_group_id so cleanup removes every fixture row.
  const sameVolSiblings = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.variantGroupId, `${MARK}-samevol`));

  const allProductIds = [...fixtureProductIds, ...sameVolSiblings.map(r => r.id)];

  await db.delete(matches).where(inArray(matches.productId, allProductIds));
  await db
    .delete(competitorProductVariants)
    .where(
      inArray(
        competitorProductVariants.competitorProductId,
        db
          .select({ id: competitorProducts.id })
          .from(competitorProducts)
          .where(eq(competitorProducts.competitorId, competitor!.id)),
      ),
    );
  await db.delete(competitorProducts).where(eq(competitorProducts.competitorId, competitor!.id));
  await db.delete(competitors).where(eq(competitors.id, competitor!.id));
  await db.delete(products).where(inArray(products.id, allProductIds));

  console.log('Cleanup done.');

  await database.onModuleDestroy();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }

  console.log('\nAll assertions PASSED');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
