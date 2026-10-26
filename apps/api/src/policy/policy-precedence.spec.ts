import {
	effectiveDiscoveryEnabled,
	effectivePriceMonitoringEnabled,
	effectiveVisibleInCatalog,
	type BrandPolicyRow,
	type ProductPolicyOverrideRow
} from './policy-precedence';

function brand(overrides: Partial<BrandPolicyRow> = {}): BrandPolicyRow {
	return {
		canonicalKey: 'artdeco',
		visibleInCatalog: true,
		makeupDiscoveryEnabled: true,
		ovicoDiscoveryEnabled: true,
		priceMonitoringEnabled: true,
		...overrides
	};
}

function override(overrides: Partial<ProductPolicyOverrideRow> = {}): ProductPolicyOverrideRow {
	return {
		productId: 1,
		catalogEnabledOverride: null,
		discoveryEnabledOverride: null,
		priceMonitoringEnabledOverride: null,
		...overrides
	};
}

describe('effectiveDiscoveryEnabled - tri-state precedence', () => {
	it('product override true force-enables a SKU whose brand has discovery disabled for that competitor', () => {
		const b = brand({ makeupDiscoveryEnabled: false });
		const o = override({ discoveryEnabledOverride: true });

		expect(effectiveDiscoveryEnabled(b, o, 'makeup.md')).toBe(true);
	});

	it('product override false force-disables a SKU whose brand has discovery enabled', () => {
		const b = brand({ makeupDiscoveryEnabled: true });
		const o = override({ discoveryEnabledOverride: false });

		expect(effectiveDiscoveryEnabled(b, o, 'makeup.md')).toBe(false);
	});

	it('NULL override inherits the brand policy', () => {
		const enabled = brand({ ovicoDiscoveryEnabled: true });
		const disabled = brand({ ovicoDiscoveryEnabled: false });
		const o = override();

		expect(effectiveDiscoveryEnabled(enabled, o, 'ovico.md')).toBe(true);
		expect(effectiveDiscoveryEnabled(disabled, o, 'ovico.md')).toBe(false);
	});

	it('no product override row at all (sparse table) behaves identically to a NULL override', () => {
		expect(effectiveDiscoveryEnabled(brand({ makeupDiscoveryEnabled: false }), undefined, 'makeup.md')).toBe(
			false
		);
	});

	it('defaults to true when a brand has never been bootstrapped', () => {
		expect(effectiveDiscoveryEnabled(undefined, undefined, 'makeup.md')).toBe(true);
	});
});

describe('effectiveDiscoveryEnabled - competitor-specific brand policy', () => {
	it('MAKEUP and OVICO discovery policy are independent for the same brand', () => {
		const b = brand({ makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: true });
		const o = override();

		expect(effectiveDiscoveryEnabled(b, o, 'makeup.md')).toBe(false);
		expect(effectiveDiscoveryEnabled(b, o, 'ovico.md')).toBe(true);
	});

	it('a single product-level discoveryEnabledOverride is NOT competitor-specific - it applies to both', () => {
		const b = brand({ makeupDiscoveryEnabled: true, ovicoDiscoveryEnabled: true });
		const o = override({ discoveryEnabledOverride: false });

		expect(effectiveDiscoveryEnabled(b, o, 'makeup.md')).toBe(false);
		expect(effectiveDiscoveryEnabled(b, o, 'ovico.md')).toBe(false);
	});
});

describe('policy independence - catalog / discovery / price monitoring never leak into each other', () => {
	it('catalog visibility has no effect on discovery eligibility', () => {
		const hiddenButDiscoverable = brand({ visibleInCatalog: false, makeupDiscoveryEnabled: true });
		expect(effectiveDiscoveryEnabled(hiddenButDiscoverable, override(), 'makeup.md')).toBe(true);
	});

	it('price monitoring policy has no effect on discovery eligibility', () => {
		const b = brand({ priceMonitoringEnabled: false, ovicoDiscoveryEnabled: true });
		expect(effectiveDiscoveryEnabled(b, override(), 'ovico.md')).toBe(true);
	});

	it('discovery policy has no effect on catalog visibility', () => {
		const b = brand({ makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: false, visibleInCatalog: true });
		expect(effectiveVisibleInCatalog(b, override())).toBe(true);
	});

	it('discovery policy has no effect on price monitoring eligibility', () => {
		const b = brand({ makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: false, priceMonitoringEnabled: true });
		expect(effectivePriceMonitoringEnabled(b, override())).toBe(true);
	});

	it('a product override on one dimension does not affect the other two', () => {
		const b = brand();
		const o = override({ discoveryEnabledOverride: false });

		expect(effectiveVisibleInCatalog(b, o)).toBe(true);
		expect(effectivePriceMonitoringEnabled(b, o)).toBe(true);
	});
});

describe('effectivePriceMonitoringEnabled - tri-state precedence', () => {
	it('product override can force-enable monitoring for a brand that disabled it', () => {
		const b = brand({ priceMonitoringEnabled: false });
		expect(effectivePriceMonitoringEnabled(b, override({ priceMonitoringEnabledOverride: true }))).toBe(true);
	});

	it('product override can force-disable monitoring for a brand that enabled it', () => {
		const b = brand({ priceMonitoringEnabled: true });
		expect(effectivePriceMonitoringEnabled(b, override({ priceMonitoringEnabledOverride: false }))).toBe(false);
	});
});

describe('effectiveVisibleInCatalog - tri-state precedence', () => {
	it('product override can force-show a SKU whose brand is hidden', () => {
		const b = brand({ visibleInCatalog: false });
		expect(effectiveVisibleInCatalog(b, override({ catalogEnabledOverride: true }))).toBe(true);
	});

	it('product override can force-hide a SKU whose brand is visible', () => {
		const b = brand({ visibleInCatalog: true });
		expect(effectiveVisibleInCatalog(b, override({ catalogEnabledOverride: false }))).toBe(false);
	});
});
