// Milestone 5 (Admin Control Center) - real-Postgres verification, same
// convention as M1-M4's verify-*.ts scripts: prefix-scoped fake fixtures,
// idempotent cleanup, and (learned the hard way during M4) NEVER touch the
// real MAKEUP/OVICO/Brocard/Aroma competitor rows or any real brand row
// (givenchy/chanel/lancome/dior as of this writing) - every fixture here
// uses a clearly fake brand/product identity, and this script snapshots +
// re-asserts those real rows are untouched before and after.
import 'reflect-metadata';

import {
  brands,
  competitors,
  discoveryAttempts,
  eq,
  inArray,
  knownPlaceholderImages,
  productPolicyOverrides,
  products,
  sql,
} from '@price/db';

import { AdminBrandsService } from '../src/admin/admin-brands.service';
import { AdminPlaceholdersService } from '../src/admin/admin-placeholders.service';
import { AdminSettingsController } from '../src/admin/admin-settings.controller';
import { DatabaseService } from '../src/database/database.service';
import { canonicalBrand } from '../src/matching/matching-normalization';
import { AppSettingsService } from '../src/policy/app-settings.service';
import { loadPolicyContext, PolicyService } from '../src/policy/policy.service';
import { ProductsService } from '../src/products/products.service';

const RAW_BRAND_A = 'M5VerifyFakeBrandAlpha';
const RAW_BRAND_B = 'M5VerifyFakeBrandBeta';
const KEY_A = canonicalBrand(RAW_BRAND_A);
const KEY_B = canonicalBrand(RAW_BRAND_B);
const PREFIX = 'm5_verify_';

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
  const brandRows = await database.db.select().from(brands).where(inArray(brands.canonicalKey, REAL_BRAND_KEYS));
  return { competitorRows: JSON.stringify(competitorRows), brandRows: JSON.stringify(brandRows) };
}

async function main() {
  const database = new DatabaseService();
  const policyService = new PolicyService(database);
  const productsService = new ProductsService(database, policyService);
  const appSettings = new AppSettingsService(database);
  const adminBrands = new AdminBrandsService(database);
  const adminPlaceholders = new AdminPlaceholdersService(database);
  const settingsController = new AdminSettingsController(appSettings);

  const before = await snapshotRealRows(database);

  const fixtureProductIds: number[] = [];
  let prodReal: { id: number } | undefined;

  try {
    console.log('--- fixtures: two fake brands, one enabled, one fully paused ---');
    await database.db.insert(brands).values([
      { canonicalKey: KEY_A, displayName: RAW_BRAND_A, visibleInCatalog: true, makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true, priceMonitoringEnabled: true },
      { canonicalKey: KEY_B, displayName: RAW_BRAND_B, visibleInCatalog: true, makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: false, priceMonitoringEnabled: true },
    ]);

    const [prodA] = await database.db
      .insert(products)
      .values({ sourceKey: `${PREFIX}a`, brand: RAW_BRAND_A, name: 'Fake Product A', url: 'https://example.test/a', imageUrl: null })
      .returning();
    const [prodB] = await database.db
      .insert(products)
      .values({ sourceKey: `${PREFIX}b`, brand: RAW_BRAND_B, name: 'Fake Product B', url: 'https://example.test/b', imageUrl: 'https://example.test/placeholder.png' })
      .returning();
    fixtureProductIds.push(prodA!.id, prodB!.id);

    console.log('--- brand mutation: live-read proof (no caching, no snapshot) ---');
    {
      const beforeCtx = await loadPolicyContext(database);
      check('brand A starts discovery-enabled on MAKEUP', beforeCtx.discoveryEnabled(RAW_BRAND_A, prodA!.id, 'makeup.md') === true);

      await adminBrands.patch(KEY_A, { makeupDiscoveryEnabled: false });

      const afterCtx = await loadPolicyContext(database);
      check('the VERY NEXT loadPolicyContext() call (same function discovery-targets.ts uses) reflects the PATCH - no caching, no snapshot', afterCtx.discoveryEnabled(RAW_BRAND_A, prodA!.id, 'makeup.md') === false);
      check('ovico flag was untouched by the makeup-only patch', afterCtx.discoveryEnabled(RAW_BRAND_A, prodA!.id, 'ovico.md') === true);

      // Idempotency: setting the same flag to its current value again is a
      // clean no-op success, not an error.
      const again = await adminBrands.patch(KEY_A, { makeupDiscoveryEnabled: false });
      check('re-patching to the same value is a clean no-op success', again.makeupDiscoveryEnabled === false);

      await adminBrands.patch(KEY_A, { makeupDiscoveryEnabled: true });
    }

    console.log('--- bulk brand action touches ONLY brands, never product_policy_overrides ---');
    {
      const overridesBefore = await database.db.select().from(productPolicyOverrides).where(inArray(productPolicyOverrides.productId, fixtureProductIds));
      await adminBrands.bulkPatch([KEY_A, KEY_B], { priceMonitoringEnabled: false });
      const overridesAfter = await database.db.select().from(productPolicyOverrides).where(inArray(productPolicyOverrides.productId, fixtureProductIds));
      check('bulk patch never creates/touches product_policy_overrides rows', overridesBefore.length === overridesAfter.length && overridesAfter.length === 0);
      const [rowA] = await database.db.select().from(brands).where(eq(brands.canonicalKey, KEY_A));
      const [rowB] = await database.db.select().from(brands).where(eq(brands.canonicalKey, KEY_B));
      check('bulk patch applied to both brands', rowA!.priceMonitoringEnabled === false && rowB!.priceMonitoringEnabled === false);
      await adminBrands.bulkPatch([KEY_A, KEY_B], { priceMonitoringEnabled: true });
    }

    console.log('--- tri-state product override: inherit / force-enable-over-disabled-brand / force-disable-over-enabled-brand ---');
    {
      // Brand B is fully discovery-paused (both competitors false, set in
      // the fixture above). Force-enable product B's discovery override
      // over that disabled brand.
      await productsService.updateProductPolicy(prodB!.id, { discoveryEnabledOverride: true }, 'verify-script');
      const ctx1 = await loadPolicyContext(database);
      check('force-enable-over-disabled-brand: override wins', ctx1.discoveryEnabled(RAW_BRAND_B, prodB!.id, 'makeup.md') === true);
      check('force-enable-over-disabled-brand: override wins on the OTHER competitor too (single, non-competitor-specific product override)', ctx1.discoveryEnabled(RAW_BRAND_B, prodB!.id, 'ovico.md') === true);

      // Brand A is discovery-enabled. Force-disable product A's discovery
      // override over that enabled brand.
      await productsService.updateProductPolicy(prodA!.id, { discoveryEnabledOverride: false, exclusionReason: 'other', reasonNote: 'verify script fixture' }, 'verify-script');
      const ctx2 = await loadPolicyContext(database);
      check('force-disable-over-enabled-brand: override wins', ctx2.discoveryEnabled(RAW_BRAND_A, prodA!.id, 'makeup.md') === false);

      console.log('--- catalog / discovery / price-monitoring independence ---');
      // Product A has ONLY a discovery override set - catalog visibility
      // and price monitoring must still read from the (enabled) brand,
      // completely independent of the discovery override.
      check('catalog visibility is independent of a discovery-only override', ctx2.visibleInCatalog(RAW_BRAND_A, prodA!.id) === true);
      check('price monitoring is independent of a discovery-only override', ctx2.priceMonitoringEnabled(RAW_BRAND_A, prodA!.id) === true);

      console.log('--- clearing overrides restores inheritance AND deletes the sparse row ---');
      const beforeClear = await database.db.select().from(productPolicyOverrides).where(eq(productPolicyOverrides.productId, prodA!.id));
      check('override row exists before clearing', beforeClear.length === 1);

      const cleared = await productsService.updateProductPolicy(
        prodA!.id,
        { discoveryEnabledOverride: null, catalogEnabledOverride: null, priceMonitoringEnabledOverride: null, exclusionReason: null, reasonNote: null },
        'verify-script',
      );
      check('updateProductPolicy returns null when the row is deleted', cleared === null);

      const afterClear = await database.db.select().from(productPolicyOverrides).where(eq(productPolicyOverrides.productId, prodA!.id));
      check('the product_policy_overrides row is GONE, not just all-NULL', afterClear.length === 0);

      const ctx3 = await loadPolicyContext(database);
      check('discovery is back to inheriting the brand value after clearing', ctx3.discoveryEnabled(RAW_BRAND_A, prodA!.id, 'makeup.md') === true);

      // Clean up product B's override too.
      await productsService.updateProductPolicy(prodB!.id, { discoveryEnabledOverride: null }, 'verify-script');
    }

    console.log('--- admin product list can see hidden/missing-image products the ordinary catalog excludes ---');
    {
      const ordinaryCatalog = await productsService.findAll({ search: 'Fake Product A' });
      check('the ordinary catalog hides this product (missing image)', ordinaryCatalog.items.length === 0);

      const adminList = await productsService.findAllAdmin({ search: 'Fake Product A' });
      check('admin list finds it anyway', adminList.items.some(item => item.id === prodA!.id));
      const foundA = adminList.items.find(item => item.id === prodA!.id);
      check('admin list reports its image status as missing', foundA?.imageStatus === 'missing');
    }

    console.log('--- effective-policy diagnostic (GET /admin/products/:id shape) ---');
    {
      const detail = await productsService.getAdminProductDetail(prodB!.id);
      check('diagnostic reports the brand-level value', detail.effectivePolicy.discovery.makeup.brandValue === false);
      check('diagnostic reports override as null after clearing', detail.effectivePolicy.discovery.makeup.override === null);
      check('diagnostic reports the effective result', detail.effectivePolicy.discovery.makeup.effective === false);
      check('diagnostic never leaks matcher internals (no ruleScore/ruleSignals key anywhere)', !JSON.stringify(detail).includes('ruleScore') && !JSON.stringify(detail).includes('ruleSignals'));
      check('price-monitoring diagnostic carries the "never deletes match data" UI copy', detail.effectivePolicy.priceMonitoring.note.toLowerCase().includes('never delete'));
    }

    console.log('--- ai.enabled + threshold validation + DEEPSEEK_API_KEY never exposed ---');
    {
      process.env.DEEPSEEK_API_KEY = 'sk-should-never-leak-this-value';
      const settings = await settingsController.get();
      check('DEEPSEEK_API_KEY value never appears anywhere in the settings response', !JSON.stringify(settings).includes('should-never-leak'));
      check('provider key field name never appears either', !JSON.stringify(settings).toLowerCase().includes('deepseek_api_key'.toLowerCase()) );

      let rejected = false;
      try {
        await settingsController.patchAi({ autoConfirmThreshold: 1.5 });
      } catch {
        rejected = true;
      }
      check('an out-of-range threshold (1.5) is REJECTED, not clamped', rejected);

      let rejectedNegative = false;
      try {
        await settingsController.patchAi({ autoConfirmThreshold: -0.1 });
      } catch {
        rejectedNegative = true;
      }
      check('a negative threshold is rejected', rejectedNegative);

      const patched = await settingsController.patchAi({ autoConfirmThreshold: 0.75, enabled: true });
      check('a valid in-range threshold persists exactly, not rounded/clamped', patched.autoConfirmThreshold === 0.75);
      check('enabled persists', patched.enabled === true);

      // Restore whatever the real value was before this script touched it.
      await settingsController.patchAi({ autoConfirmThreshold: 0.9, enabled: false });
    }

    console.log('--- data quality classification (delta-based, robust against real catalog noise) ---');
    {
      const summaryBefore = await productsService.getDataQualitySummary();
      // Add one more fixture product in each image-state bucket.
      const [insertedReal] = await database.db
        .insert(products)
        .values({ sourceKey: `${PREFIX}real`, brand: RAW_BRAND_A, name: 'Fake Product Real Image', imageUrl: 'https://example.test/real-unique-image.png' })
        .returning();
      prodReal = insertedReal;
      fixtureProductIds.push(prodReal!.id);

      const summaryAfter = await productsService.getDataQualitySummary();
      // Product A (imageUrl=null) was created earlier, BEFORE this
      // section's "before" snapshot - so the missing-image count is
      // unaffected here; only the newly-added real-image fixture moves
      // the count in this section.
      check('missing-image count is unaffected by this section (fixture A already existed)', summaryAfter.images.missing === summaryBefore.images.missing);
      check('real-image count increased by exactly 1 (the new fixture)', summaryAfter.images.real === summaryBefore.images.real + 1);
      // Product B's imageUrl isn't a confirmed placeholder yet at this
      // point in the script, so it counts as "real" too, not "placeholder".
      check('placeholder count unaffected so far', summaryAfter.images.placeholder === summaryBefore.images.placeholder);
      check('products.brand is NOT NULL in the schema - "empty/unknown brand" is genuinely impossible, reported as 0', summaryAfter.productsWithEmptyBrand === 0);
    }

    console.log('--- placeholder registry: add / duplicate conflict / reclassification / remove ---');
    {
      const placeholderUrl = 'https://example.test/placeholder.png'; // prodB's imageUrl

      const beforeAdd = await productsService.getDataQualitySummary();
      await adminPlaceholders.add(placeholderUrl, 'verify fixture', 'verify-script');

      const afterAdd = await productsService.getDataQualitySummary();
      check('confirming a placeholder reclassifies the affected product live (real -> placeholder)', afterAdd.images.placeholder === beforeAdd.images.placeholder + 1 && afterAdd.images.real === beforeAdd.images.real - 1);

      // Exercises findAllAdmin's imageStatus column directly (the actual
      // production call site of imageStatusExpr(), as a plain SELECT list
      // item) - not just the aggregate count above.
      const placeholderFiltered = await productsService.findAllAdmin({ imageState: 'placeholder', search: 'Fake Product' });
      check('findAllAdmin(imageState=placeholder) finds prodB and reports its imageStatus as placeholder', placeholderFiltered.items.some(item => item.id === prodB!.id && item.imageStatus === 'placeholder'));
      check('findAllAdmin(imageState=placeholder) does NOT also misclassify the still-real fixture', !placeholderFiltered.items.some(item => item.id === prodReal!.id));

      const realFiltered = await productsService.findAllAdmin({ imageState: 'real', search: 'Fake Product' });
      check('findAllAdmin(imageState=real) finds the real-image fixture and reports it correctly', realFiltered.items.some(item => item.id === prodReal!.id && item.imageStatus === 'real'));
      check('findAllAdmin(imageState=real) does NOT include the now-placeholder product', !realFiltered.items.some(item => item.id === prodB!.id));

      let duplicateRejected = false;
      try {
        await adminPlaceholders.add(placeholderUrl, 'second attempt', 'verify-script');
      } catch (error) {
        duplicateRejected = (error as { status?: number }).status === 409;
      }
      check('a duplicate add returns a clean 409, not a raw Postgres unique-violation', duplicateRejected);

      const list = await adminPlaceholders.list();
      const entry = list.find(row => row.imageUrl === placeholderUrl);
      check('list() reports the correct affected-product-count for this URL', entry?.affectedProductCount === 1);

      await adminPlaceholders.remove(placeholderUrl);
      const afterRemove = await productsService.getDataQualitySummary();
      check('removing the registry row reclassifies the product back to real (never touches products.image_url itself)', afterRemove.images.placeholder === beforeAdd.images.placeholder && afterRemove.images.real === beforeAdd.images.real);

      const [stillThere] = await database.db.select().from(products).where(eq(products.id, prodB!.id));
      check("remove() never touched the product's own image_url column", stillThere?.imageUrl === placeholderUrl);
    }

    console.log('--- placeholder-candidate report: diagnostic only, never auto-registers ---');
    {
      // 3 fixture products sharing one never-before-seen image URL.
      const sharedUrl = 'https://example.test/repeated-candidate-image.png';
      const [c1] = await database.db.insert(products).values({ sourceKey: `${PREFIX}cand1`, brand: RAW_BRAND_A, name: 'Fake Candidate 1', imageUrl: sharedUrl }).returning();
      const [c2] = await database.db.insert(products).values({ sourceKey: `${PREFIX}cand2`, brand: RAW_BRAND_A, name: 'Fake Candidate 2', imageUrl: sharedUrl }).returning();
      const [c3] = await database.db.insert(products).values({ sourceKey: `${PREFIX}cand3`, brand: RAW_BRAND_A, name: 'Fake Candidate 3', imageUrl: sharedUrl }).returning();
      fixtureProductIds.push(c1!.id, c2!.id, c3!.id);

      const registryBefore = await adminPlaceholders.list();

      const candidatesAtHighThreshold = await adminPlaceholders.candidates(10);
      check('a threshold above the real occurrence count finds nothing for this URL', !candidatesAtHighThreshold.some(c => c.imageUrl === sharedUrl));

      const candidatesAtThreshold = await adminPlaceholders.candidates(3);
      const found = candidatesAtThreshold.find(c => c.imageUrl === sharedUrl);
      check('a threshold at/below the real occurrence count surfaces it', found !== undefined && found.occurrences === 3);
      check('the report includes a small sample of affected products', (found?.sample.length ?? 0) > 0 && (found?.sample.length ?? 0) <= 3);

      const registryAfter = await adminPlaceholders.list();
      check('running the candidate report NEVER inserts into known_placeholder_images', registryAfter.length === registryBefore.length);
    }
  } finally {
    console.log('--- cleanup ---');
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, fixtureProductIds));
    await database.db.delete(productPolicyOverrides).where(inArray(productPolicyOverrides.productId, fixtureProductIds));
    if (fixtureProductIds.length > 0) {
      await database.db.delete(products).where(inArray(products.id, fixtureProductIds));
    }
    await database.db.delete(knownPlaceholderImages).where(eq(knownPlaceholderImages.imageUrl, 'https://example.test/placeholder.png'));
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
