import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, brands, eq, inArray, type Brand } from '@price/db';

import { DatabaseService } from '../database/database.service';

export type BrandPolicyPatch = Partial<
	Pick<Brand, 'visibleInCatalog' | 'makeupDiscoveryEnabled' | 'ovicoDiscoveryEnabled' | 'priceMonitoringEnabled'>
>;

// Brand CRUD for Admin's /admin/brands screen. Deliberately thin - brands
// is a small (~100 rows), dense table (every brand seen by Vizaje sync
// already has a row with all-enabled defaults, see schema.ts), so there is
// no pagination/search machinery to reuse or duplicate here, unlike
// products. Writes ONLY ever touch `brands` columns - never
// product_policy_overrides (that table has its own write path in
// ProductsService.updateProductPolicy).
@Injectable()
export class AdminBrandsService {
	constructor(private readonly database: DatabaseService) {}

	async list(): Promise<Brand[]> {
		return this.database.db.select().from(brands).orderBy(asc(brands.displayName));
	}

	async getOrThrow(canonicalKey: string): Promise<Brand> {
		const [row] = await this.database.db.select().from(brands).where(eq(brands.canonicalKey, canonicalKey));
		if (!row) throw new NotFoundException(`Brand "${canonicalKey}" not found`);
		return row;
	}

	// Idempotent by construction - an UPDATE ... SET x = $1 that sets a
	// column to the value it already holds is a clean no-op success (same
	// row count, same resulting state), never an error. Only ever writes
	// the 4 policy columns the brief allows - never canonicalKey/
	// displayName, and the schema has no master discoveryEnabled column to
	// accidentally write (see Milestone 1's design note on `brands` in
	// schema.ts).
	async patch(canonicalKey: string, patch: BrandPolicyPatch): Promise<Brand> {
		await this.getOrThrow(canonicalKey);

		const [row] = await this.database.db
			.update(brands)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(brands.canonicalKey, canonicalKey))
			.returning();

		return row!;
	}

	// Bulk brand action (e.g. "pause this brand entirely" = both discovery
	// flags false in one request, or a multi-select "disable catalog for
	// these N brands"). Still only ever writes the same 4 policy columns,
	// still only on `brands` - never product_policy_overrides. Unknown
	// canonicalKeys are silently skipped (UPDATE ... WHERE IN affects
	// however many rows actually exist) rather than erroring the whole
	// batch over one bad key.
	async bulkPatch(canonicalKeys: string[], patch: BrandPolicyPatch): Promise<Brand[]> {
		if (canonicalKeys.length === 0) return [];

		return this.database.db
			.update(brands)
			.set({ ...patch, updatedAt: new Date() })
			.where(inArray(brands.canonicalKey, canonicalKeys))
			.returning();
	}
}
