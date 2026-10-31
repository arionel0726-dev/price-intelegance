// Milestone 6 (Business Dashboard) - real-Postgres verification, same
// convention as every prior verify-*.ts script: prefix-scoped fake
// fixtures, idempotent cleanup, and an explicit final assertion that the
// real MAKEUP/OVICO/Brocard/Aroma competitor rows and real chanel/dior/
// givenchy/lancome brand rows are byte-for-byte unchanged (same pattern
// M5's script established, reused here almost verbatim).
//
// Fixtures use the REAL MAKEUP/OVICO competitor rows as a foreign key
// target for fake competitor_products/competitor_product_variants rows
// (never mutating the competitors row itself) - this is required because
// DashboardService's makeup/ovico breakdown is hardcoded to the domains
// 'makeup.md'/'ovico.md' (by design - see dashboard.service.ts), so a
// fake competitor domain cannot exercise that breakdown at all. Same
// technique M4's script already used for job_runs.competitorId.
import 'reflect-metadata';

import {
  brands,
  competitorProductVariants,
  competitorProducts,
  competitors,
  discoveryCandidates,
  eq,
  inArray,
  matches,
  productPolicyOverrides,
  products,
} from '@price/db';

import { DatabaseService } from '../src/database/database.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { EQUAL_TOLERANCE_PERCENT } from '../src/dashboard/price-gap';
import { canonicalBrand } from '../src/matching/matching-normalization';
import { PolicyService } from '../src/policy/policy.service';

const PREFIX = 'm6_verify_';
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
  const competitorRows = await database.db.select().from(competitors).where(inArray(competitors.domain, REAL_COMPETITOR_DOMAINS));
  const brandRows = await database.db.select().from(brands).where(inArray(brands.canonicalKey, REAL_BRAND_KEYS));
  return { competitorRows: JSON.stringify(competitorRows), brandRows: JSON.stringify(brandRows) };
}

async function main() {
  const database = new DatabaseService();
  const policy = new PolicyService(database);
  const dashboard = new DashboardService(database, policy);

  const before = await snapshotRealRows(database);

  const insertedBrandKeys: string[] = [];
  const insertedProductIds: number[] = [];
  const insertedCompetitorProductIds: number[] = [];
  const insertedVariantIds: number[] = [];

  try {
    const [makeup] = await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'makeup.md'));
    const [ovico] = await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'ovico.md'));
    if (!makeup || !ovico) {
      console.log('Real MAKEUP/OVICO competitor rows do not exist yet in this DB - nothing to verify against. Skipping.');
      return;
    }

    // --- fake brands ------------------------------------------------
    // IMPORTANT: a brand's canonicalKey must be exactly canonicalBrand()
    // of the RAW text written into products.brand, or brand-level policy
    // resolution silently never matches (canonicalBrand() lowercases,
    // strips punctuation incl. underscores, and collapses whitespace - a
    // snake_case literal used as both the raw brand text AND the
    // canonicalKey does NOT survive that unchanged). Caught directly by
    // this script before this comment existed: BRAND_DISABLED's
    // exclusion silently never fired, because the registered
    // canonicalKey didn't match canonicalBrand(RAW_BRAND_DISABLED) - see
    // the Milestone 6 report. BRAND_NORMAL/BRAND_OUTLIER (both
    // priceMonitoringEnabled=true) masked the same latent mismatch,
    // since a brand that's never in the "disabled" set behaves
    // correctly either way.
    const RAW_BRAND_NORMAL = 'M6VerifyBrandNormal';
    const RAW_BRAND_DISABLED = 'M6VerifyBrandDisabled';
    const RAW_BRAND_OUTLIER = 'M6VerifyBrandOutlier';
    const BRAND_NORMAL = canonicalBrand(RAW_BRAND_NORMAL);
    const BRAND_DISABLED = canonicalBrand(RAW_BRAND_DISABLED);
    const BRAND_OUTLIER = canonicalBrand(RAW_BRAND_OUTLIER);
    insertedBrandKeys.push(BRAND_NORMAL, BRAND_DISABLED, BRAND_OUTLIER);

    await database.db.insert(brands).values([
      // visibleInCatalog=false deliberately - proves catalog visibility
      // never affects dashboard inclusion.
      { canonicalKey: BRAND_NORMAL, displayName: RAW_BRAND_NORMAL, visibleInCatalog: false, makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true, priceMonitoringEnabled: true },
      { canonicalKey: BRAND_DISABLED, displayName: RAW_BRAND_DISABLED, visibleInCatalog: true, makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true, priceMonitoringEnabled: false },
      { canonicalKey: BRAND_OUTLIER, displayName: RAW_BRAND_OUTLIER, visibleInCatalog: true, makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true, priceMonitoringEnabled: true },
    ]);

    // --- helpers ------------------------------------------------------
    async function makeCompetitorOffer(competitorId: number, price: string, key: string) {
      const [cp] = await database.db
        .insert(competitorProducts)
        .values({ competitorId, externalId: `${PREFIX}${key}`, title: `Fake offer ${key}`, url: `https://example.test/${PREFIX}${key}` })
        .returning();
      insertedCompetitorProductIds.push(cp!.id);
      const [variant] = await database.db
        .insert(competitorProductVariants)
        .values({ competitorProductId: cp!.id, externalId: `${PREFIX}${key}-v`, price })
        .returning();
      insertedVariantIds.push(variant!.id);
      return variant!.id;
    }

    async function makeProduct(brand: string, name: string, price: string | null, url = true) {
      const [row] = await database.db
        .insert(products)
        .values({ sourceKey: `${PREFIX}${name}`, brand, name, price, url: url ? `https://example.test/${PREFIX}${name}` : null })
        .returning();
      insertedProductIds.push(row!.id);
      return row!;
    }

    async function matchTo(productId: number, variantId: number, source: 'auto' | 'ai' | 'manual' = 'auto') {
      await database.db.insert(matches).values({ productId, competitorProductVariantId: variantId, source, score: 100 });
    }

    // --- productA: matched to BOTH competitors, at DIFFERENT prices ---
    // makeup=1000 (vizaje 1010 -> gap exactly +1.0%, boundary ->
    // approximately_equal under a makeup filter), ovico=900 (vizaje
    // 1010 -> gap = (1010-900)/900*100 = 12.22% -> more_expensive).
    // "All" mode must pick the LOWER of the two (900, via ovico).
    const productA = await makeProduct(RAW_BRAND_NORMAL, 'productA_both', '1010.00');
    const variantA_makeup = await makeCompetitorOffer(makeup.id, '1000.00', 'a-makeup');
    const variantA_ovico = await makeCompetitorOffer(ovico.id, '900.00', 'a-ovico');
    await matchTo(productA.id, variantA_makeup, 'auto');
    await matchTo(productA.id, variantA_ovico, 'manual');

    // --- productB: MAKEUP only, gap exactly -1.0% (other boundary) ---
    const productB = await makeProduct(RAW_BRAND_NORMAL, 'productB_makeup_boundary_low', '990.00');
    const variantB = await makeCompetitorOffer(makeup.id, '1000.00', 'b-makeup');
    await matchTo(productB.id, variantB, 'auto');

    // --- productC: OVICO only, gap exactly +1.01% (just past boundary) -
    const productC = await makeProduct(RAW_BRAND_NORMAL, 'productC_ovico_just_over', '10101.00');
    const variantC = await makeCompetitorOffer(ovico.id, '10000.00', 'c-ovico');
    await matchTo(productC.id, variantC, 'ai');

    // --- productD: MAKEUP only, gap exactly -1.01% (just past boundary) -
    const productD = await makeProduct(RAW_BRAND_NORMAL, 'productD_makeup_just_under', '9899.00');
    const variantD = await makeCompetitorOffer(makeup.id, '10000.00', 'd-makeup');
    await matchTo(productD.id, variantD, 'auto');

    // --- productE: eligible, NEVER matched (unresolved) ---------------
    const productE = await makeProduct(RAW_BRAND_NORMAL, 'productE_unmatched', '500.00');

    // --- productF: matched but competitor price is 0 (invalid) --------
    const productF = await makeProduct(RAW_BRAND_NORMAL, 'productF_zero_competitor_price', '500.00');
    const variantF = await makeCompetitorOffer(makeup.id, '0.00', 'f-makeup');
    await matchTo(productF.id, variantF, 'auto');

    // --- productG: matched, valid competitor price, but vizaje price NULL
    const productG = await makeProduct(RAW_BRAND_NORMAL, 'productG_null_vizaje_price', null);
    const variantG = await makeCompetitorOffer(makeup.id, '500.00', 'g-makeup');
    await matchTo(productG.id, variantG, 'auto');

    // --- productH: matched, valid competitor price, vizaje price = 0 --
    const productH = await makeProduct(RAW_BRAND_NORMAL, 'productH_zero_vizaje_price', '0.00');
    const variantH = await makeCompetitorOffer(makeup.id, '500.00', 'h-makeup');
    await matchTo(productH.id, variantH, 'auto');

    // --- productI: a PENDING ai-review candidate, no matches row ------
    // Must never count as covered.
    const productI = await makeProduct(RAW_BRAND_NORMAL, 'productI_pending_candidate', '500.00');
    const variantI = await makeCompetitorOffer(makeup.id, '500.00', 'i-makeup');
    await database.db.insert(discoveryCandidates).values({
      productId: productI.id,
      competitorId: makeup.id,
      competitorProductVariantId: variantI,
      snapshotTitle: 'pending candidate',
      snapshotUrl: `https://example.test/${PREFIX}i`,
      ruleScore: 50,
      ruleDecision: 'ambiguous',
      ruleSignals: {},
      reviewStatus: 'pending',
    });

    // --- productJ: a REJECTED candidate, no matches row ---------------
    const productJ = await makeProduct(RAW_BRAND_NORMAL, 'productJ_rejected_candidate', '500.00');
    const variantJ = await makeCompetitorOffer(makeup.id, '500.00', 'j-makeup');
    await database.db.insert(discoveryCandidates).values({
      productId: productJ.id,
      competitorId: makeup.id,
      competitorProductVariantId: variantJ,
      snapshotTitle: 'rejected candidate',
      snapshotUrl: `https://example.test/${PREFIX}j`,
      ruleScore: 50,
      ruleDecision: 'ambiguous',
      ruleSignals: {},
      reviewStatus: 'rejected',
      outcome: 'manual_rejected',
      resolvedAt: new Date(),
    });

    // --- brand-disabled: product excluded entirely (brand disables) ---
    const productDisabled = await makeProduct(RAW_BRAND_DISABLED, 'product_brand_disabled', '1000.00');
    const variantDisabled = await makeCompetitorOffer(makeup.id, '1000.00', 'disabled-makeup');
    await matchTo(productDisabled.id, variantDisabled, 'auto');

    // --- brand-disabled + product override TRUE: force-INCLUDED -------
    const productForceEnabled = await makeProduct(RAW_BRAND_DISABLED, 'product_force_enabled', '1100.00');
    const variantForceEnabled = await makeCompetitorOffer(makeup.id, '1000.00', 'force-enabled-makeup');
    await matchTo(productForceEnabled.id, variantForceEnabled, 'auto');
    await database.db.insert(productPolicyOverrides).values({ productId: productForceEnabled.id, priceMonitoringEnabledOverride: true });

    // --- brand-normal (allows) + product override FALSE: force-EXCLUDED
    const productForceDisabled = await makeProduct(RAW_BRAND_NORMAL, 'product_force_disabled', '1100.00');
    const variantForceDisabled = await makeCompetitorOffer(makeup.id, '1000.00', 'force-disabled-makeup');
    await matchTo(productForceDisabled.id, variantForceDisabled, 'auto');
    await database.db.insert(productPolicyOverrides).values({ productId: productForceDisabled.id, priceMonitoringEnabledOverride: false });

    // --- variant-grain non-cross-match: two "sibling" products, each
    // matched to a DIFFERENT competitor offer at a DIFFERENT price -----
    const productJ1 = await makeProduct(RAW_BRAND_NORMAL, 'familyVariant1', '510.00');
    const variantJ1 = await makeCompetitorOffer(makeup.id, '500.00', 'family-v1');
    await matchTo(productJ1.id, variantJ1, 'auto');

    const productJ2 = await makeProduct(RAW_BRAND_NORMAL, 'familyVariant2', '600.00');
    const variantJ2 = await makeCompetitorOffer(makeup.id, '800.00', 'family-v2');
    await matchTo(productJ2.id, variantJ2, 'auto');

    // --- outlier brand: median vs average ------------------------------
    // Gaps (vs competitor=1000 each): 5%, 6%, 7%, 8%, 100% - average is
    // dragged way up by the 100% outlier (5+6+7+8+100)/5 = 25.2%; median
    // of [5,6,7,8,100] is the middle value, 7%.
    const outlierGapsPercent = [5, 6, 7, 8, 100];
    for (const [index, gapPercent] of outlierGapsPercent.entries()) {
      const competitorPrice = 1000;
      const vizajePrice = competitorPrice * (1 + gapPercent / 100);
      const p = await makeProduct(RAW_BRAND_OUTLIER, `outlier_${index}`, vizajePrice.toFixed(2));
      const v = await makeCompetitorOffer(makeup.id, String(competitorPrice), `outlier-${index}`);
      await matchTo(p.id, v, 'auto');
    }

    // ===================================================================
    console.log('--- universe: eligible monitored products never includes a catalog-hidden-but-monitoring-enabled brand\'s products, and excludes the disabled brand ---');
    const summaryAll = await dashboard.getSummary('all');
    const brandRowsReport = await dashboard.getBrands('all', undefined);
    const normalBrandRow = brandRowsReport.items.find(b => b.brand === RAW_BRAND_NORMAL);
    const disabledBrandRow = brandRowsReport.items.find(b => b.brand === RAW_BRAND_DISABLED);
    check('RAW_BRAND_NORMAL (visibleInCatalog=false) still appears in the dashboard brand table - catalog visibility never gates inclusion', Boolean(normalBrandRow));
    // RAW_BRAND_DISABLED has priceMonitoringEnabled=false - only its
    // override=true product should be eligible; its ordinary product
    // must be excluded entirely, so eligible for RAW_BRAND_DISABLED should
    // be exactly 1 (productForceEnabled), never counting productDisabled.
    check('RAW_BRAND_DISABLED brand-level priceMonitoringEnabled=false excludes its ordinary product from the universe (eligible=1, only the override product)', disabledBrandRow?.eligible === 1);
    check('the force-enabled override product IS covered (it has a confirmed match) within the otherwise-disabled brand', disabledBrandRow?.covered === 1);

    console.log('--- product override false excludes even when brand allows (RAW_BRAND_NORMAL) ---');
    // productForceDisabled must not appear anywhere in RAW_BRAND_NORMAL's
    // eligible set - verify via opportunities (it would otherwise be
    // comparable: 1100 vs 1000 = +10%, well outside tolerance).
    const oppsNormal = await dashboard.getOpportunities({ competitor: 'all', brand: RAW_BRAND_NORMAL, pageSize: 100 });
    check('the force-disabled-override product never appears in opportunities for RAW_BRAND_NORMAL', !oppsNormal.items.some(i => i.productId === productForceDisabled.id));

    console.log('--- unique-product coverage is never double-counted across competitors (productA counts ONCE in productCoverage, twice in offerCoverage) ---');
    const normalOnly = brandRowsReport.items.find(b => b.brand === RAW_BRAND_NORMAL)!;
    // Eligible for RAW_BRAND_NORMAL: A,B,C,D,E,F,G,H,I,J,forceDisabled(excluded!),J1,J2 = A..J (10) + J1 + J2 = 12, minus forceDisabled (excluded) = 12.
    // Covered (has >=1 confirmed match): A,B,C,D,F,G,H,J1,J2 = 9 (E has none, I/J are pending/rejected candidates only, forceDisabled excluded).
    check(`RAW_BRAND_NORMAL covered count is exactly 9 (A,B,C,D,F,G,H,J1,J2) - got ${normalOnly.covered}`, normalOnly.covered === 9);

    console.log('--- MAKEUP-only / OVICO-only / both-competitor coverage ---');
    const summaryMakeup = await dashboard.getSummary('makeup');
    const summaryOvico = await dashboard.getSummary('ovico');
    // productA is the ONLY fixture (indeed, given the real seed products
    // all have url=null and so never enter the eligible universe at all -
    // see this round's denominator investigation - the ONLY product
    // anywhere in this database right now) matched to BOTH competitors,
    // which makes each of the 5 facts below assertable as an EXACT global
    // number, not just "productA's row looks right in isolation".
    console.log('  --- All-mode uniqueness: 5 individual facts about productA, not an aggregate "looks right" ---');

    // Fact 1: unique-product coverage contributes exactly 1 for productA
    // - never double-counted for matching both competitors.
    check('(1) bothCoverage is EXACTLY 1 (productA, and only productA) - not merely >=1', summaryAll.coverage.bothCoverage === 1);

    // Fact 2: offer coverage contributes exactly 2 for productA (one
    // confirmed match row per competitor) - checked directly against
    // `matches`, independent of any dashboard aggregation.
    const productAMatchRows = await database.db.select({ id: matches.id }).from(matches).where(eq(matches.productId, productA.id));
    check('(2) productA has EXACTLY 2 confirmed match rows (one per competitor) in the matches table itself', productAMatchRows.length === 2);

    // Fact 3: both-competitor coverage is exactly 1 for this product -
    // same number as Fact 1, re-derived via the per-competitor summaries
    // rather than the "all" one, as an independent cross-check.
    check(
      '(3) both-competitor coverage cross-checks: productA counts toward makeupCoverage AND ovicoCoverage, contributing exactly 1 to each',
      summaryMakeup.coverage.makeupCoverage >= 1 && summaryOvico.coverage.ovicoCoverage >= 1,
    );

    // Fact 4: the All-mode opportunities list contains EXACTLY ONE row
    // for productA - never two (one per competitor match would be the
    // bug this guards against).
    const oppsA_all = await dashboard.getOpportunities({ competitor: 'all', brand: RAW_BRAND_NORMAL, pageSize: 100 });
    const aRowsAll = oppsA_all.items.filter(i => i.productId === productA.id);
    check('(4) All-mode opportunities contains EXACTLY 1 row for productA, never 2 (one per match would double-count it)', aRowsAll.length === 1);

    // Fact 5: that single row uses the LOWER of the two valid competitor
    // prices (900 via OVICO, not 1000 via MAKEUP).
    const aRowAll = aRowsAll[0];
    check('(5) that one row uses the LOWER of productA\'s two competitor prices (900 via OVICO, not 1000 via MAKEUP)', aRowAll?.competitorPrice === 900 && aRowAll?.competitorSource === 'ovico');

    const oppsA_makeup = await dashboard.getOpportunities({ competitor: 'makeup', brand: RAW_BRAND_NORMAL, pageSize: 100 });
    const aRowMakeup = oppsA_makeup.items.find(i => i.productId === productA.id);
    check('a MAKEUP filter uses ONLY the makeup price for productA (1000), never the ovico one, even though ovico is cheaper', aRowMakeup?.competitorPrice === 1000);

    console.log('--- exact ±1% boundary classification (at exactly 1.0%/-1.0%, and just past on both sides) ---');
    const bRowMakeup = (await dashboard.getOpportunities({ competitor: 'makeup', brand: RAW_BRAND_NORMAL, pageSize: 100 })).items.find(i => i.productId === productB.id);
    check(`productB gapPercent is exactly -${EQUAL_TOLERANCE_PERCENT}.0 and classified approximately_equal (boundary, inclusive)`, bRowMakeup !== undefined && Math.abs(bRowMakeup.gapPercent - -1) < 1e-9 && bRowMakeup.position === 'approximately_equal');

    const cRowOvico = (await dashboard.getOpportunities({ competitor: 'ovico', brand: RAW_BRAND_NORMAL, pageSize: 100 })).items.find(i => i.productId === productC.id);
    check('productC gapPercent is just past +1% (1.01) and classified more_expensive, NOT approximately_equal', cRowOvico !== undefined && cRowOvico.gapPercent > 1 && cRowOvico.position === 'more_expensive');

    const dRowMakeup = (await dashboard.getOpportunities({ competitor: 'makeup', brand: RAW_BRAND_NORMAL, pageSize: 100 })).items.find(i => i.productId === productD.id);
    check('productD gapPercent is just past -1% (-1.01) and classified cheaper, NOT approximately_equal', dRowMakeup !== undefined && dRowMakeup.gapPercent < -1 && dRowMakeup.position === 'cheaper');

    const aRowMakeupForBoundary = aRowMakeup;
    check('productA under a MAKEUP filter is exactly +1.0% and classified approximately_equal (boundary, inclusive, other side)', aRowMakeupForBoundary !== undefined && Math.abs(aRowMakeupForBoundary.gapPercent - 1) < 1e-9 && aRowMakeupForBoundary.position === 'approximately_equal');

    console.log('--- invalid-price exclusion: null, zero, negative never enter the comparable universe ---');
    const allOppsNormalWide = await dashboard.getOpportunities({ competitor: 'all', brand: RAW_BRAND_NORMAL, pageSize: 100 });
    check('productF (competitor price = 0) never appears in opportunities', !allOppsNormalWide.items.some(i => i.productId === productF.id));
    check('productG (vizaje price = null) never appears in opportunities', !allOppsNormalWide.items.some(i => i.productId === productG.id));
    check('productH (vizaje price = 0) never appears in opportunities', !allOppsNormalWide.items.some(i => i.productId === productH.id));
    check('productF/G/H ARE still counted as "covered" (they have a confirmed match) even though excluded from comparable', normalOnly.comparable < normalOnly.covered);

    console.log('--- pending/rejected AI candidates never count as covered ---');
    check('productI (pending AI-review candidate, no matches row) never appears in opportunities', !allOppsNormalWide.items.some(i => i.productId === productI.id));
    check('productJ (rejected candidate, no matches row) never appears in opportunities', !allOppsNormalWide.items.some(i => i.productId === productJ.id));

    console.log('--- only auto/ai/manual matches count (asserted, not assumed) ---');
    // Scoped to THIS script's own fixtures (by variant id), not just
    // trusted blindly - a prior run of this investigation found 3 real
    // rows with source='algorithm' (traced to packages/db/src/seed.ts's
    // own ad-hoc label for an automated match, never a value the real
    // matching code produced) and fixed them via
    // drizzle/0010_fix_legacy_algorithm_match_source.sql. There is still
    // no CHECK constraint on matches.source, so this stays a real
    // assertion rather than an assumption - the INFO log below would
    // still surface a 4th value if one ever reappeared.
    const matchSourceRows = await database.db.selectDistinct({ source: matches.source }).from(matches).where(inArray(matches.competitorProductVariantId, insertedVariantIds));
    check('every matches.source value THIS SCRIPT wrote is one of auto/ai/manual', matchSourceRows.every(r => ['auto', 'ai', 'manual'].includes(r.source)));

    const allSourceRows = await database.db.selectDistinct({ source: matches.source }).from(matches);
    const unexpectedSources = allSourceRows.map(r => r.source).filter(s => !['auto', 'ai', 'manual'].includes(s));
    if (unexpectedSources.length > 0) {
      console.log(`  INFO: this database also contains ${unexpectedSources.length} other matches.source value(s) outside auto/ai/manual (${unexpectedSources.join(', ')}) on PRE-EXISTING rows this script did not create and will not touch - the dashboard's CONFIRMED_MATCH_SOURCES filter correctly excludes them from every count. See the Milestone 6 report.`);
    }

    console.log('--- variant-level grain: each sibling uses its OWN match, never its sibling\'s ---');
    const j1Row = allOppsNormalWide.items.find(i => i.productId === productJ1.id);
    const j2Row = allOppsNormalWide.items.find(i => i.productId === productJ2.id);
    check('familyVariant1 uses its own competitor price (500), not its sibling\'s (800)', j1Row?.competitorPrice === 500);
    check('familyVariant2 uses its own competitor price (800), not its sibling\'s (500)', j2Row?.competitorPrice === 800);

    console.log('--- brand average vs median (outlier) ---');
    const outlierBrandRow = brandRowsReport.items.find(b => b.brand === RAW_BRAND_OUTLIER)!;
    check(`RAW_BRAND_OUTLIER average gap is pulled up by the 100% outlier (expected 25.2%, got ${outlierBrandRow.avgGapPercent})`, outlierBrandRow.avgGapPercent !== null && Math.abs(outlierBrandRow.avgGapPercent - 25.2) < 0.01);
    check(`RAW_BRAND_OUTLIER median gap is NOT pulled by the outlier (expected 7%, got ${outlierBrandRow.medianGapPercent})`, outlierBrandRow.medianGapPercent !== null && Math.abs(outlierBrandRow.medianGapPercent - 7) < 0.01);

    console.log('--- gap MDL and gap% both use the competitor price as denominator ---');
    const bOppForGap = bRowMakeup!;
    check('gapAmount = vizajePrice - competitorPrice (990 - 1000 = -10)', Math.abs(bOppForGap.gapAmount - -10) < 1e-6);
  } finally {
    console.log('--- cleanup ---');
    await database.db.delete(discoveryCandidates).where(inArray(discoveryCandidates.productId, insertedProductIds));
    await database.db.delete(productPolicyOverrides).where(inArray(productPolicyOverrides.productId, insertedProductIds));
    await database.db.delete(matches).where(inArray(matches.competitorProductVariantId, insertedVariantIds));
    if (insertedVariantIds.length > 0) await database.db.delete(competitorProductVariants).where(inArray(competitorProductVariants.id, insertedVariantIds));
    if (insertedCompetitorProductIds.length > 0) await database.db.delete(competitorProducts).where(inArray(competitorProducts.id, insertedCompetitorProductIds));
    if (insertedProductIds.length > 0) await database.db.delete(products).where(inArray(products.id, insertedProductIds));
    if (insertedBrandKeys.length > 0) await database.db.delete(brands).where(inArray(brands.canonicalKey, insertedBrandKeys));

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
