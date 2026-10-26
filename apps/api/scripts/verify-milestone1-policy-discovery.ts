import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import {
  and,
  brands,
  competitorProducts,
  competitorProductVariants,
  competitors,
  discoveryAttempts,
  discoveryCandidates,
  eq,
  ilike,
  inArray,
  knownPlaceholderImages,
  matches,
  productPolicyOverrides,
  products,
} from '@price/db';

import { AppModule } from '../src/app.module';
import { DiscoveryStateService } from '../src/competitors/discovery-state.service';
import { selectDiscoveryTargets } from '../src/competitors/discovery-targets';
import { DatabaseService } from '../src/database/database.service';
import { canonicalBrand } from '../src/matching/matching-normalization';
import type { MatchSignals } from '../src/matching/matching.types';
import { loadPolicyContext } from '../src/policy/policy.service';
import { ProductsService } from '../src/products/products.service';

// Milestone 1 (Price Intelligence Discovery/Policy) integration verification -
// same real-NestJS-services-against-the-real-dev-DB convention as
// verify-discovery-filters.ts. Covers everything from the milestone's
// verification list that needs a live DB (the pure tri-state precedence
// rules are covered separately by src/policy/policy-precedence.spec.ts).
//
// Run with (from apps/api): bun run scripts/verify-milestone1-policy-discovery.ts

const PREFIX = 'test-m1-';

let failures = 0;
function check(label: string, condition: boolean): void {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${label}`);
  if (!condition) failures += 1;
}

const DUMMY_SIGNALS: MatchSignals = {
  brandMatched: true,
  concentrationVizaje: null,
  concentrationCompetitor: null,
  concentrationConflict: false,
  concentrationAgree: false,
  volumeVizaje: null,
  volumeCompetitor: null,
  volumeConflict: false,
  volumeExactMatch: false,
  shadeVizaje: null,
  shadeCompetitor: null,
  shadeConflict: false,
  shadeExactMatch: false,
  namedShadeVizaje: null,
  namedShadeCompetitor: null,
  namedShadeConflict: false,
  namedShadeExactMatch: false,
  typeVizaje: null,
  typeCompetitor: null,
  typeConflict: false,
  isColorProduct: false,
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const database = app.get(DatabaseService);
  const discoveryState = app.get(DiscoveryStateService);
  const productsService = app.get(ProductsService);

  const insertedProductIds: number[] = [];
  const BRAND_DISABLED = `${PREFIX}brand-disabled`;
  const BRAND_ENABLED = `${PREFIX}brand-enabled`;

  try {
    // --- Fixtures ----------------------------------------------------------
    const [makeupCompetitor] = await database.db
      .insert(competitors)
      .values({ name: 'MAKEUP', domain: 'makeup.md' })
      .onConflictDoNothing({ target: competitors.domain })
      .returning({ id: competitors.id });
    const makeupId =
      makeupCompetitor?.id ??
      (await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'makeup.md')))[0]!.id;

    await database.db
      .insert(competitors)
      .values({ name: 'OVICO', domain: 'ovico.md' })
      .onConflictDoNothing({ target: competitors.domain });

    await database.db
      .insert(brands)
      .values([
        {
          // canonicalKey must be the CANONICALIZED form, same as a real
          // brand bootstrap (vizaje-sync.service.ts / backfill-brands.ts) -
          // product rows below store the raw BRAND_DISABLED/BRAND_ENABLED
          // text, and every policy lookup resolves raw -> canonical before
          // matching against this table.
          canonicalKey: canonicalBrand(BRAND_DISABLED),
          displayName: 'Test Brand (MAKEUP discovery disabled)',
          makeupDiscoveryEnabled: false,
        },
        {
          canonicalKey: canonicalBrand(BRAND_ENABLED),
          displayName: 'Test Brand (all enabled)',
        },
      ])
      .onConflictDoNothing({ target: brands.canonicalKey });

    const [pOverrideForceEnable, pOverrideForceDisable, pNeverChecked, pNoMatch, pError, pAmbiguous, pPendingSkip, pRetryFuture, pMissingImage, pPlaceholderImage, pRealImage, pPriceMonitoringOff] =
      await database.db
        .insert(products)
        .values([
          {
            sourceKey: `${PREFIX}p-force-enable`,
            brand: BRAND_DISABLED,
            name: 'P force-enable (brand disables MAKEUP, product override forces it back on)',
            url: `https://vizaje-nica.md/${PREFIX}p-force-enable`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-force-disable`,
            brand: BRAND_ENABLED,
            name: 'P force-disable (brand enables, product override disables)',
            url: `https://vizaje-nica.md/${PREFIX}p-force-disable`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-never-checked`,
            brand: BRAND_ENABLED,
            name: 'P never-checked baseline',
            url: `https://vizaje-nica.md/${PREFIX}p-never-checked`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-no-match`,
            brand: BRAND_ENABLED,
            name: 'P no-match state',
            url: `https://vizaje-nica.md/${PREFIX}p-no-match`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-error`,
            brand: BRAND_ENABLED,
            name: 'P error state',
            url: `https://vizaje-nica.md/${PREFIX}p-error`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-ambiguous`,
            brand: BRAND_ENABLED,
            name: 'P ambiguous candidate',
            url: `https://vizaje-nica.md/${PREFIX}p-ambiguous`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-pending-skip`,
            brand: BRAND_ENABLED,
            name: 'P already pending_review - must not be reselected',
            url: `https://vizaje-nica.md/${PREFIX}p-pending-skip`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-retry-future`,
            brand: BRAND_ENABLED,
            name: 'P no_match with future retryEligibleAt - must not be reselected yet',
            url: `https://vizaje-nica.md/${PREFIX}p-retry-future`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-missing-image`,
            brand: BRAND_ENABLED,
            name: 'P missing image',
            url: `https://vizaje-nica.md/${PREFIX}p-missing-image`,
            imageUrl: null,
          },
          {
            sourceKey: `${PREFIX}p-placeholder-image`,
            brand: BRAND_ENABLED,
            name: 'P placeholder image',
            url: `https://vizaje-nica.md/${PREFIX}p-placeholder-image`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}placeholder.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-real-image`,
            brand: BRAND_ENABLED,
            name: 'P real image',
            url: `https://vizaje-nica.md/${PREFIX}p-real-image`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}real-unique.jpg`,
          },
          {
            sourceKey: `${PREFIX}p-price-monitoring-off`,
            brand: BRAND_ENABLED,
            name: 'P price monitoring disabled via product override',
            url: `https://vizaje-nica.md/${PREFIX}p-price-monitoring-off`,
            imageUrl: `https://vizaje-nica.md/images/${PREFIX}baseline.jpg`,
          },
        ])
        .returning({ id: products.id });

    insertedProductIds.push(
      pOverrideForceEnable.id,
      pOverrideForceDisable.id,
      pNeverChecked.id,
      pNoMatch.id,
      pError.id,
      pAmbiguous.id,
      pPendingSkip.id,
      pRetryFuture.id,
      pMissingImage.id,
      pPlaceholderImage.id,
      pRealImage.id,
      pPriceMonitoringOff.id,
    );

    await database.db.insert(productPolicyOverrides).values([
      { productId: pOverrideForceEnable.id, discoveryEnabledOverride: true },
      { productId: pOverrideForceDisable.id, discoveryEnabledOverride: false, exclusionReason: 'internal' },
      { productId: pPriceMonitoringOff.id, priceMonitoringEnabledOverride: false, exclusionReason: 'duplicate' },
    ]);

    await database.db.insert(discoveryAttempts).values([
      {
        productId: pPendingSkip.id,
        competitorId: makeupId,
        status: 'pending_review',
        lastCheckedAt: new Date(),
        attemptCount: 1,
      },
      {
        productId: pRetryFuture.id,
        competitorId: makeupId,
        status: 'no_match',
        lastCheckedAt: new Date(),
        attemptCount: 1,
        retryEligibleAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ]);

    // --- Policy tri-state precedence (end to end through selectDiscoveryTargets) ---
    console.log('=== product override forces discovery back on for a brand-disabled MAKEUP competitor ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        productIds: [pOverrideForceEnable.id, pOverrideForceDisable.id],
      });
      // NOTE: productIds bypasses policy by design (documented pre-existing
      // "bypass every filter" escape hatch - see discovery-targets.ts) so
      // this specific assertion uses the FILTERED path instead, via brand,
      // to exercise the real policy gate.
      void selection;

      const filtered = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_DISABLED,
        onlyUnmatched: true,
      });
      const ids = filtered.targets.map(t => t.id);
      check(
        'product override (true) re-includes a SKU whose brand disables MAKEUP discovery',
        ids.includes(pOverrideForceEnable.id),
      );
    }

    console.log('=== product override forces discovery off for a brand-enabled competitor ===');
    {
      const filtered = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      const ids = filtered.targets.map(t => t.id);
      check(
        'product override (false) excludes a SKU whose brand allows MAKEUP discovery',
        !ids.includes(pOverrideForceDisable.id),
      );
      check('an ordinary brand-enabled SKU with no override is still selected', ids.includes(pNeverChecked.id));
    }

    console.log('=== MAKEUP and OVICO brand policy are competitor-specific ===');
    {
      // Add a second, override-free product on BRAND_DISABLED
      // (makeupDiscoveryEnabled=false, ovicoDiscoveryEnabled left at the
      // default true) so this check isolates the brand-level flag itself,
      // without pOverrideForceEnable's product-level override muddying it.
      const [pBrandDisabledPlain] = await database.db
        .insert(products)
        .values({
          sourceKey: `${PREFIX}p-brand-disabled-plain`,
          brand: BRAND_DISABLED,
          name: 'P plain SKU on the MAKEUP-disabled brand, no product override',
          url: `https://vizaje-nica.md/${PREFIX}p-brand-disabled-plain`,
        })
        .returning({ id: products.id });
      insertedProductIds.push(pBrandDisabledPlain.id);

      const makeupSelection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_DISABLED,
        onlyUnmatched: true,
      });
      const ovicoSelection = await selectDiscoveryTargets(database, 'ovico.md', `${PREFIX}rotation-ovico`, 20, {
        brand: BRAND_DISABLED,
        onlyUnmatched: true,
      });

      check(
        'makeupDiscoveryEnabled=false excludes the plain SKU from MAKEUP',
        !makeupSelection.targets.map(t => t.id).includes(pBrandDisabledPlain.id),
      );
      check(
        'the SAME brand (ovicoDiscoveryEnabled left true) still allows OVICO discovery for the plain SKU',
        ovicoSelection.targets.map(t => t.id).includes(pBrandDisabledPlain.id),
      );
    }

    console.log('=== pending_review is never reselected ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      check('a pending_review SKU is excluded from selection', !selection.targets.map(t => t.id).includes(pPendingSkip.id));
    }

    console.log('=== retryEligibleAt gates reselection ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      check(
        'a no_match SKU with a FUTURE retryEligibleAt is excluded',
        !selection.targets.map(t => t.id).includes(pRetryFuture.id),
      );

      // Flip it to a past retryEligibleAt and confirm it becomes selectable.
      await database.db
        .update(discoveryAttempts)
        .set({ retryEligibleAt: new Date(Date.now() - 60_000) })
        .where(eq(discoveryAttempts.productId, pRetryFuture.id));

      const afterBackoff = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      check(
        'the same SKU becomes selectable once retryEligibleAt is in the past',
        afterBackoff.targets.map(t => t.id).includes(pRetryFuture.id),
      );
    }

    // --- DiscoveryStateService persistence outcomes -------------------------
    console.log('=== no_match persistence ===');
    {
      await discoveryState.recordNoMatch(pNoMatch.id, makeupId);
      const [row] = await database.db
        .select()
        .from(discoveryAttempts)
        .where(and(eq(discoveryAttempts.productId, pNoMatch.id), eq(discoveryAttempts.competitorId, makeupId)));
      check('a no_match row is written with status=no_match', row?.status === 'no_match');
      check('retryEligibleAt is set in the future', Boolean(row?.retryEligibleAt && row.retryEligibleAt.getTime() > Date.now()));
      check('attemptCount starts at 1', row?.attemptCount === 1);
    }

    console.log('=== error persistence (distinct from no_match) ===');
    {
      await discoveryState.recordError(pError.id, makeupId, 'candidate_parse_failed');
      const [row] = await database.db
        .select()
        .from(discoveryAttempts)
        .where(and(eq(discoveryAttempts.productId, pError.id), eq(discoveryAttempts.competitorId, makeupId)));
      check('an error row is written with status=error', row?.status === 'error');
      check('lastError records the reason', row?.lastError === 'candidate_parse_failed');
    }

    console.log('=== ambiguous persistence / candidate snapshot (AI disabled this milestone) ===');
    let ambiguousVariantId!: number;
    {
      const [competitorProduct] = await database.db
        .insert(competitorProducts)
        .values({
          competitorId: makeupId,
          externalId: `${PREFIX}ambiguous-external`,
          title: 'Synthetic ambiguous MAKEUP product',
          url: `https://makeup.md/${PREFIX}ambiguous`,
        })
        .returning({ id: competitorProducts.id });
      const [variant] = await database.db
        .insert(competitorProductVariants)
        .values({
          competitorProductId: competitorProduct!.id,
          externalId: `${PREFIX}ambiguous-variant`,
          label: '50 ml',
        })
        .returning({ id: competitorProductVariants.id });
      ambiguousVariantId = variant!.id;

      await discoveryState.recordAmbiguous({
        productId: pAmbiguous.id,
        competitorId: makeupId,
        competitorProductVariantId: ambiguousVariantId,
        snapshotTitle: 'Synthetic ambiguous MAKEUP product',
        snapshotVariantLabel: '50 ml',
        snapshotVariantVolume: '50 ml',
        snapshotPrice: '199.00',
        snapshotUrl: `https://makeup.md/${PREFIX}ambiguous`,
        snapshotImageUrl: null,
        ruleScore: 72,
        ruleSignals: DUMMY_SIGNALS,
      });

      const [attemptRow] = await database.db
        .select()
        .from(discoveryAttempts)
        .where(and(eq(discoveryAttempts.productId, pAmbiguous.id), eq(discoveryAttempts.competitorId, makeupId)));
      check('the pair is marked pending_review', attemptRow?.status === 'pending_review');
      check('pending_review has no retry backoff (resolved by review, not time)', attemptRow?.retryEligibleAt === null);

      const [candidateRow] = await database.db
        .select()
        .from(discoveryCandidates)
        .where(
          and(
            eq(discoveryCandidates.productId, pAmbiguous.id),
            eq(discoveryCandidates.competitorId, makeupId),
            eq(discoveryCandidates.competitorProductVariantId, ambiguousVariantId),
          ),
        );
      check('a discovery_candidates row exists', Boolean(candidateRow));
      check('ruleDecision is ambiguous', candidateRow?.ruleDecision === 'ambiguous');
      check('reviewStatus is pending (not lost, not auto-approved)', candidateRow?.reviewStatus === 'pending');
      check('aiVerdict is NULL - no DeepSeek call happened this milestone', candidateRow?.aiVerdict === null);
      check('snapshot fields are frozen at discovery time', candidateRow?.snapshotPrice === '199.00');
    }

    console.log('=== a confirmed match clears any leftover discovery_attempts row ===');
    {
      // pAmbiguous already has a pending_review discoveryAttempts row from
      // the test above - recordMatched must clear it (matched is
      // represented ONLY by `matches`, never duplicated as a status here).
      await discoveryState.recordMatched(pAmbiguous.id, makeupId);
      const rows = await database.db
        .select()
        .from(discoveryAttempts)
        .where(and(eq(discoveryAttempts.productId, pAmbiguous.id), eq(discoveryAttempts.competitorId, makeupId)));
      check('no discovery_attempts row remains for the pair', rows.length === 0);
    }

    // --- Image classification ------------------------------------------------
    console.log('=== image classification: missing / placeholder / real ===');
    {
      const placeholderUrl = `https://vizaje-nica.md/images/${PREFIX}placeholder.jpg`;
      await database.db.insert(knownPlaceholderImages).values({ imageUrl: placeholderUrl, note: 'test fixture' });

      const defaultPage = await productsService.findAll({ search: PREFIX, limit: 100 });
      const defaultIds = defaultPage.items.map(i => i.id);
      check('default catalog hides the missing-image product', !defaultIds.includes(pMissingImage.id));
      check('default catalog hides the confirmed-placeholder product', !defaultIds.includes(pPlaceholderImage.id));
      check('default catalog still shows the real-image product', defaultIds.includes(pRealImage.id));

      const includeHiddenPage = await productsService.findAll({ search: PREFIX, limit: 100, includeHidden: true });
      const includeHiddenIds = includeHiddenPage.items.map(i => i.id);
      check('includeHidden=true brings the missing-image product back', includeHiddenIds.includes(pMissingImage.id));
      check('includeHidden=true brings the placeholder product back', includeHiddenIds.includes(pPlaceholderImage.id));
    }

    console.log('=== discovery still accepts missing/placeholder-image products ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      const ids = selection.targets.map(t => t.id);
      check('a product with a NULL imageUrl is still a valid discovery target', ids.includes(pMissingImage.id));
      check('a product with a confirmed-placeholder imageUrl is still a valid discovery target', ids.includes(pPlaceholderImage.id));
    }

    // --- Catalog visibility is independent of discovery/price-monitoring ---
    console.log('=== catalog visibility has no effect on discovery eligibility (brand-level) ===');
    {
      await database.db.update(brands).set({ visibleInCatalog: false }).where(eq(brands.canonicalKey, canonicalBrand(BRAND_ENABLED)));
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      check(
        'a catalog-hidden brand is still fully discoverable',
        selection.targets.map(t => t.id).includes(pNeverChecked.id),
      );
      await database.db.update(brands).set({ visibleInCatalog: true }).where(eq(brands.canonicalKey, canonicalBrand(BRAND_ENABLED)));
    }

    console.log('=== discovery policy has no effect on catalog visibility ===');
    {
      await database.db.update(brands).set({ makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: false }).where(eq(brands.canonicalKey, canonicalBrand(BRAND_ENABLED)));
      const page = await productsService.findAll({ search: PREFIX, limit: 100 });
      check(
        'a discovery-disabled brand is still visible in the catalog',
        page.items.map(i => i.id).includes(pNeverChecked.id),
      );
      await database.db.update(brands).set({ makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true }).where(eq(brands.canonicalKey, canonicalBrand(BRAND_ENABLED)));
    }

    // --- Price monitoring policy gate on refresh selection ------------------
    console.log('=== price monitoring policy has no effect on discovery, and refresh honors it ===');
    {
      const selection = await selectDiscoveryTargets(database, 'makeup.md', `${PREFIX}rotation`, 20, {
        brand: BRAND_ENABLED,
        onlyUnmatched: true,
      });
      check(
        'a product with priceMonitoringEnabledOverride=false is still discoverable',
        selection.targets.map(t => t.id).includes(pPriceMonitoringOff.id),
      );

      // Exercise the exact same policy gate makeup-refresh.service.ts uses,
      // against a real synthetic match, without invoking the network-bound
      // parser call inside MakeupRefreshService.refresh() itself.
      const [refreshCompetitorProduct] = await database.db
        .insert(competitorProducts)
        .values({
          competitorId: makeupId,
          externalId: `${PREFIX}refresh-external`,
          title: 'Synthetic refresh-target MAKEUP product',
          url: `https://makeup.md/${PREFIX}refresh-target`,
        })
        .returning({ id: competitorProducts.id });
      const [refreshVariant] = await database.db
        .insert(competitorProductVariants)
        .values({ competitorProductId: refreshCompetitorProduct!.id, externalId: `${PREFIX}refresh-variant`, label: null })
        .returning({ id: competitorProductVariants.id });
      await database.db.insert(matches).values({
        productId: pPriceMonitoringOff.id,
        competitorProductVariantId: refreshVariant!.id,
        source: 'auto',
        score: 95,
      });

      const policyContext = await loadPolicyContext(database);
      check(
        'effectivePriceMonitoringEnabled is false for the overridden product',
        policyContext.priceMonitoringEnabled(BRAND_ENABLED, pPriceMonitoringOff.id) === false,
      );
      check(
        'effectivePriceMonitoringEnabled is true for an ordinary matched product of the same brand',
        policyContext.priceMonitoringEnabled(BRAND_ENABLED, pNeverChecked.id) === true,
      );
    }

    console.log();
    if (failures > 0) {
      console.log(`${failures} assertion(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('All assertions PASSED');
    }
  } finally {
    const ids = insertedProductIds.length > 0 ? insertedProductIds : [-1];

    await database.db.delete(discoveryCandidates).where(ilike(discoveryCandidates.snapshotUrl, `%${PREFIX}%`));
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, ids));
    await database.db.delete(matches).where(inArray(matches.productId, ids));
    await database.db.delete(competitorProductVariants).where(ilike(competitorProductVariants.externalId, `${PREFIX}%`));
    await database.db.delete(competitorProducts).where(ilike(competitorProducts.externalId, `${PREFIX}%`));
    await database.db.delete(productPolicyOverrides).where(inArray(productPolicyOverrides.productId, ids));
    await database.db.delete(knownPlaceholderImages).where(ilike(knownPlaceholderImages.imageUrl, `%${PREFIX}%`));
    await database.db.delete(products).where(ilike(products.sourceKey, `${PREFIX}%`));
    await database.db
      .delete(brands)
      .where(inArray(brands.canonicalKey, [canonicalBrand(BRAND_DISABLED), canonicalBrand(BRAND_ENABLED)]));

    await app.close();
  }
}

main()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch(error => {
    console.error('[verify-milestone1-policy-discovery] FAILED', error);
    process.exit(1);
  });
