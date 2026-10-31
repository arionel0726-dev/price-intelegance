// Milestone 6's two comparison universes - built once here, reused by
// every dashboard query (summary/brands/opportunities), so the
// definitions can never silently drift apart between endpoints.
//
// 1. ELIGIBLE MONITORED PRODUCTS (the coverage denominator) - UI label:
//    "Products currently eligible for competitor price monitoring":
//      products.url IS NOT NULL
//      AND effectivePriceMonitoringEnabled(brand, override) is true
//    Deliberately NEVER filters on visibleInCatalog - catalog visibility
//    and price-monitoring eligibility are independent per Milestone 1's
//    design (a brand/product can be hidden from the catalog while still
//    being monitored, and vice versa). This is the SAME precedence rule
//    (product override > brand policy > default true) used everywhere
//    else, computed via the shared policy-precedence.ts functions - never
//    reimplemented here.
//
//    `url IS NOT NULL` ("website-confirmed") is NOT an accidental proxy
//    here - it is this codebase's own established convention for "has a
//    live product page, confirmed by the real sync" (see the identical
//    language and predicate in ProductsService's catalog query and
//    discovery-targets.ts's selection query, both pre-existing). Checked
//    again for this milestone: `products` has no other status-like
//    column (no "active"/"live"/"sellable" flag - only `available`,
//    which is stock availability, a different question). Measured
//    against the current dev DB: all 4 seeded products have url IS NULL
//    (they are hand-written demo rows from packages/db/src/seed.ts, never
//    run through the real import/sync pipeline - not evidence against
//    the convention, just this dev seed's own shape). In a real catalog
//    populated via packages/db/scripts/import-vizaje.ts, url is expected
//    to be set once a product is actually confirmed live on the site.
//
// 2. COMPARABLE-PRICE PRODUCTS (narrower - for price-position/gap math):
//      eligible monitored product
//      AND has a CONFIRMED match (matches.source IN ('auto','ai','manual'))
//      AND the matched competitor_product_variants.price is non-null AND > 0
//      AND products.price is non-null AND > 0
//    This is always a subset of (1) - every comparable product is
//    eligible, but not every eligible product is comparable (most are
//    simply unmatched yet).
import { and, eq, exists, isNotNull, not, notInArray, or, productPolicyOverrides, products, sql, type SQL } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { canonicalBrand } from '../matching/matching-normalization';
import type { PolicyService } from '../policy/policy.service';

// Raw products.brand spellings whose canonical brand has
// priceMonitoringEnabled=false - same "small table, resolved once" shape
// as ProductsService.resolveHiddenRawBrands(), mirrored here rather than
// shared because the two conditions differ (priceMonitoringEnabled vs
// visibleInCatalog) even though the SQL shape built from them is
// identical.
export async function resolvePriceMonitoringDisabledRawBrands(database: DatabaseService, policy: PolicyService): Promise<string[]> {
	const disabledKeys = await policy.loadPriceMonitoringDisabledCanonicalBrandKeys();
	if (disabledKeys.size === 0) return [];

	const distinctBrands = await database.db.selectDistinct({ brand: products.brand }).from(products);
	return distinctBrands.map(row => row.brand).filter(brand => disabledKeys.has(canonicalBrand(brand)));
}

// Builds the "eligible monitored products" WHERE condition - exactly the
// same shape as ProductsService.buildWhere's catalog-visibility
// conditions (product override > brand policy > default true), just for
// priceMonitoringEnabled instead of visibleInCatalog. `disabledRawBrands`
// comes from resolvePriceMonitoringDisabledRawBrands() above, resolved
// once per request (not per row).
export function eligibleMonitoredCondition(database: DatabaseService, disabledRawBrands: string[]): SQL {
	const conditions: SQL[] = [isNotNull(products.url)];

	// Never force-included by a product override that sets it to false.
	conditions.push(
		not(
			exists(
				database.db
					.select({ id: productPolicyOverrides.productId })
					.from(productPolicyOverrides)
					.where(and(eq(productPolicyOverrides.productId, products.id), eq(productPolicyOverrides.priceMonitoringEnabledOverride, false))),
			),
		),
	);

	// Included either by an explicit force-enable override, or by the
	// brand not being in the disabled list.
	conditions.push(
		or(
			exists(
				database.db
					.select({ id: productPolicyOverrides.productId })
					.from(productPolicyOverrides)
					.where(and(eq(productPolicyOverrides.productId, products.id), eq(productPolicyOverrides.priceMonitoringEnabledOverride, true))),
			),
			// Literal SQL `true`, NOT `undefined`, when there is nothing to
			// exclude - matches ProductsService.buildWhere's exact fallback.
			// `or(x, undefined)` does NOT degrade to "just x is enough" in
			// drizzle; it was found (via this script) to silently drop the
			// whole OR down to requiring x on its own, which excluded every
			// ordinary product with no override at all. sql`true` is a real
			// always-true operand, so the OR behaves correctly.
			disabledRawBrands.length > 0 ? notInArray(products.brand, disabledRawBrands) : sql`true`,
		)!,
	);

	return and(...conditions)!;
}
