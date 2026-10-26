import { Injectable } from '@nestjs/common';
import { brands, eq, productPolicyOverrides } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { canonicalBrand } from '../matching/matching-normalization';
import {
	type BrandPolicyRow,
	type CompetitorDomain,
	effectiveDiscoveryEnabled,
	effectivePriceMonitoringEnabled,
	effectiveVisibleInCatalog,
	type ProductPolicyOverrideRow
} from './policy-precedence';

// Batch-loads the (small - ~100 brands, sparse overrides) policy tables
// once per caller (one discovery run, one refresh run, one catalog page),
// then answers effective-policy questions in memory - the same "load once,
// filter in JS" shape discovery-targets.ts already uses for canonicalBrand
// text matching, for the same reason: canonicalBrand() involves an alias
// table that isn't expressible as a plain SQL predicate.
// Plain function (not just a class method) so call sites that are not
// themselves NestJS-managed classes - selectDiscoveryTargets() in
// discovery-targets.ts is a bare async function, not an @Injectable - can
// load a PolicyContext without constructing a DI graph just for one query.
// PolicyService.loadContext() below delegates to this for DI callers.
export async function loadPolicyContext(database: DatabaseService): Promise<PolicyContext> {
	const [brandRows, overrideRows] = await Promise.all([
		database.db.select().from(brands),
		database.db.select().from(productPolicyOverrides)
	]);

	return new PolicyContext(brandRows, overrideRows);
}

@Injectable()
export class PolicyService {
	constructor(private readonly database: DatabaseService) {}

	async loadContext(): Promise<PolicyContext> {
		return loadPolicyContext(this.database);
	}

	// Canonical keys whose brand-level visibleInCatalog is false - used by
	// ProductsService to build a SQL-pushable catalog visibility condition
	// (catalog listing is paginated SQL, so policy filtering there cannot be
	// a JS post-filter the way discovery/refresh selection can).
	async loadHiddenCanonicalBrandKeys(): Promise<Set<string>> {
		const rows = await this.database.db
			.select({ canonicalKey: brands.canonicalKey })
			.from(brands)
			.where(eq(brands.visibleInCatalog, false));

		return new Set(rows.map(row => row.canonicalKey));
	}
}

export class PolicyContext {
	private readonly brandByCanonicalKey: Map<string, BrandPolicyRow>;
	private readonly overrideByProductId: Map<number, ProductPolicyOverrideRow>;

	constructor(brandRows: BrandPolicyRow[], overrideRows: ProductPolicyOverrideRow[]) {
		this.brandByCanonicalKey = new Map(brandRows.map(row => [row.canonicalKey, row]));
		this.overrideByProductId = new Map(overrideRows.map(row => [row.productId, row]));
	}

	private resolve(productBrand: string, productId: number) {
		const brand = this.brandByCanonicalKey.get(canonicalBrand(productBrand));
		const override = this.overrideByProductId.get(productId);
		return { brand, override };
	}

	visibleInCatalog(productBrand: string, productId: number): boolean {
		const { brand, override } = this.resolve(productBrand, productId);
		return effectiveVisibleInCatalog(brand, override);
	}

	discoveryEnabled(productBrand: string, productId: number, competitor: CompetitorDomain): boolean {
		const { brand, override } = this.resolve(productBrand, productId);
		return effectiveDiscoveryEnabled(brand, override, competitor);
	}

	priceMonitoringEnabled(productBrand: string, productId: number): boolean {
		const { brand, override } = this.resolve(productBrand, productId);
		return effectivePriceMonitoringEnabled(brand, override);
	}
}
