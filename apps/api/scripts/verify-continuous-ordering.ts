// Targeted M2 regression check: selectNextContinuousTarget's documented
// ordering guarantee - "never-checked products first (lowest id first),
// then retry-eligible products oldest-retryEligibleAt-first" (see
// discovery-targets.ts's own doc comment). No existing verify-*.ts script
// asserted this by name (verify-discovery-filters.ts exercises the
// filtered-selection path, not this specific ordering), so this is a new,
// narrowly-scoped addition - written in response to the M5-triage
// coordinator request to cover any M2 guarantee not already covered by a
// script. discovery-targets.ts itself has been byte-identical since M2's
// original commit (ebcb74c) - confirmed via `git log --oneline
// ebcb74c..HEAD -- apps/api/src/competitors/discovery-targets.ts`
// returning no commits - so this is due-diligence, not a response to a
// suspected bug.
import 'reflect-metadata';

import { competitors, discoveryAttempts, eq, inArray, products } from '@price/db';

import { selectNextContinuousTarget } from '../src/competitors/discovery-targets';
import { DatabaseService } from '../src/database/database.service';

const PREFIX = 'verify_continuous_ordering_';

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  OK: ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${label}`);
  }
}

async function main() {
  const database = new DatabaseService();
  const insertedProductIds: number[] = [];

  try {
    const [makeup] = await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'makeup.md'));
    if (!makeup) {
      console.log('No real MAKEUP competitor row exists yet - nothing to verify against. Skipping.');
      return;
    }

    // Two never-checked products (no discovery_attempts row at all for
    // this product x makeup.md), inserted with higher.id-first so a
    // naive "insertion order" or "most recent" selection would get this
    // wrong - only an explicit ORDER BY products.id ASC gets it right.
    const neverCheckedHigh = await database.db
      .insert(products)
      .values({ sourceKey: `${PREFIX}never-checked-b`, brand: `${PREFIX}Brand`, name: 'Never checked B (inserted first, should sort second)', url: `https://example.test/${PREFIX}b` })
      .returning();
    const neverCheckedLow = await database.db
      .insert(products)
      .values({ sourceKey: `${PREFIX}never-checked-a`, brand: `${PREFIX}Brand`, name: 'Never checked A (inserted second, should sort first)', url: `https://example.test/${PREFIX}a` })
      .returning();
    insertedProductIds.push(neverCheckedHigh[0]!.id, neverCheckedLow[0]!.id);

    // A retry-eligible product (HAS a discovery_attempts row, long-past
    // retryEligibleAt) - must never be selected ahead of ANY never-checked
    // product, no matter how overdue its retry is.
    const [retryEligible] = await database.db
      .insert(products)
      .values({ sourceKey: `${PREFIX}retry-eligible`, brand: `${PREFIX}Brand`, name: 'Retry eligible (must sort LAST, after both never-checked)', url: `https://example.test/${PREFIX}retry` })
      .returning();
    insertedProductIds.push(retryEligible!.id);
    await database.db.insert(discoveryAttempts).values({
      productId: retryEligible!.id,
      competitorId: makeup.id,
      status: 'no_match',
      lastCheckedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      retryEligibleAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // a year overdue
    });

    console.log('--- phase 1: never-checked wins over an overdue retry-eligible product, lowest id first ---');
    const first = await selectNextContinuousTarget(database, 'makeup.md', { brand: `${PREFIX}Brand`, onlyUnmatched: true });
    // Serial ids are assigned in INSERTION order, so `neverCheckedHigh`
    // (inserted FIRST, above) actually holds the LOWER id, and
    // `neverCheckedLow` (inserted SECOND) holds the HIGHER one - the
    // names describe each row's role in the assertion (which one SHOULD
    // sort first), not insertion order.
    const lowerIdNeverChecked = neverCheckedHigh[0]!.id < neverCheckedLow[0]!.id ? neverCheckedHigh[0]! : neverCheckedLow[0]!;
    check('the first selection is a never-checked product, not the overdue retry-eligible one', first?.id === neverCheckedLow[0]!.id || first?.id === neverCheckedHigh[0]!.id);
    check('among the two never-checked products, the LOWER id is selected first', first?.id === lowerIdNeverChecked.id);

    // Neutralize the never-checked products (give them a discovery_attempts
    // row each) so phase 1 is exhausted and phase 2 (retry-eligible,
    // oldest-retryEligibleAt-first) is what actually runs next.
    await database.db.insert(discoveryAttempts).values([
      { productId: neverCheckedLow[0]!.id, competitorId: makeup.id, status: 'no_match', lastCheckedAt: new Date(), retryEligibleAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, // not yet eligible
      { productId: neverCheckedHigh[0]!.id, competitorId: makeup.id, status: 'no_match', lastCheckedAt: new Date(), retryEligibleAt: new Date(Date.now() - 1000) }, // eligible, but much more recent than retryEligible's year-old row
    ]);

    console.log('--- phase 2: among retry-eligible products, the OLDEST retryEligibleAt wins ---');
    const second = await selectNextContinuousTarget(database, 'makeup.md', { brand: `${PREFIX}Brand`, onlyUnmatched: true });
    check(
      'the year-overdue retry-eligible product is selected ahead of the one eligible a second ago',
      second?.id === retryEligible!.id,
    );

    console.log('--- a retry not yet eligible is never selected ---');
    // Remove the two PRODUCTS that were actually eligible (not just their
    // attempt rows - deleting only the attempt row would turn a product
    // back into "never-checked" again, which is a different case).
    // What's left is exactly one product whose only discovery_attempts
    // row has a future retryEligibleAt.
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, [retryEligible!.id, neverCheckedHigh[0]!.id]));
    await database.db.delete(products).where(inArray(products.id, [retryEligible!.id, neverCheckedHigh[0]!.id]));
    const third = await selectNextContinuousTarget(database, 'makeup.md', { brand: `${PREFIX}Brand`, onlyUnmatched: true });
    check('with nothing never-checked and the only remaining candidate not yet eligible, selection is correctly null', third === null);
  } finally {
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, insertedProductIds));
    if (insertedProductIds.length > 0) {
      await database.db.delete(products).where(inArray(products.id, insertedProductIds));
    }
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
