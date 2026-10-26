// Pure precedence logic for brand/product policy - no DB access, so this is
// the one place the "product override > brand policy > default true" rule
// is implemented. Every caller (discovery selection, price refresh, catalog
// visibility) goes through these three functions instead of re-deriving the
// precedence itself - see policy.service.ts for the DB-loading counterpart.
//
// Catalog visibility, discovery eligibility and price-monitoring eligibility
// are kept strictly independent of each other on purpose - a brand/product
// can be hidden from the catalog while still being discovered/refreshed,
// and vice versa. Never combine these three into a single "enabled" check.

export type BrandPolicyRow = {
	canonicalKey: string;
	visibleInCatalog: boolean;
	makeupDiscoveryEnabled: boolean;
	ovicoDiscoveryEnabled: boolean;
	priceMonitoringEnabled: boolean;
};

export type ProductPolicyOverrideRow = {
	productId: number;
	catalogEnabledOverride: boolean | null;
	discoveryEnabledOverride: boolean | null;
	priceMonitoringEnabledOverride: boolean | null;
};

export type CompetitorDomain = 'makeup.md' | 'ovico.md';

// No brand row = brand never bootstrapped (shouldn't happen once
// vizaje-sync.service.ts's brand-bootstrap runs, but defaults must still be
// sane for a product whose brand hasn't been seen by sync yet, e.g. in a
// unit test) - default true, same as a freshly-bootstrapped brand row.
export function effectiveVisibleInCatalog(
	brand: BrandPolicyRow | undefined,
	override: ProductPolicyOverrideRow | undefined
): boolean {
	if (typeof override?.catalogEnabledOverride === 'boolean') {
		return override.catalogEnabledOverride;
	}
	return brand?.visibleInCatalog ?? true;
}

export function effectiveDiscoveryEnabled(
	brand: BrandPolicyRow | undefined,
	override: ProductPolicyOverrideRow | undefined,
	competitor: CompetitorDomain
): boolean {
	if (typeof override?.discoveryEnabledOverride === 'boolean') {
		return override.discoveryEnabledOverride;
	}

	if (!brand) return true;

	return competitor === 'makeup.md' ? brand.makeupDiscoveryEnabled : brand.ovicoDiscoveryEnabled;
}

export function effectivePriceMonitoringEnabled(
	brand: BrandPolicyRow | undefined,
	override: ProductPolicyOverrideRow | undefined
): boolean {
	if (typeof override?.priceMonitoringEnabledOverride === 'boolean') {
		return override.priceMonitoringEnabledOverride;
	}
	return brand?.priceMonitoringEnabled ?? true;
}
