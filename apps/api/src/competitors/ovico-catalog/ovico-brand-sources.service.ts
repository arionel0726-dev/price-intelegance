import { Injectable, NotFoundException } from '@nestjs/common';

import { brands, competitorBrandSources, desc, eq } from '@price/db';

import { DatabaseService } from '../../database/database.service';

export type BrandSourceStatus = 'confirmed' | 'missing' | 'needs_review';

export type NewBrandSourceInput = {
	brandId: string;
	competitorId: number;
	sourceUrl: string;
	status?: BrandSourceStatus;
	externalName?: string | null;
};

export type BrandSourcePatch = {
	sourceUrl?: string;
	status?: BrandSourceStatus;
	enabled?: boolean;
};

// Catalog Ingestion v1 (OVICO) - CRUD over competitor_brand_sources, used
// by both the Admin UI (add/edit/disable/remove a source URL) and the
// seed script that persists the milestone's 26 confirmed OVICO mappings.
// Deliberately no auto-discovery here - per the spec, a new source URL is
// always either a confirmed input to this milestone or a human Admin
// action, never something this service goes looking for on its own.
@Injectable()
export class OvicoBrandSourcesService {
	constructor(private readonly database: DatabaseService) {}

	async listForBrand(brandId: string) {
		return this.database.db
			.select()
			.from(competitorBrandSources)
			.where(eq(competitorBrandSources.brandId, brandId))
			.orderBy(desc(competitorBrandSources.createdAt));
	}

	// One row per Vizaje brand, each carrying its OVICO source rows - the
	// shape the Admin "per brand: canonical name, # of OVICO sources, source
	// URLs, enabled, last synced, sync state" view needs in one call rather
	// than N+1 queries.
	async listAllWithSources() {
		const [brandRows, sourceRows] = await Promise.all([
			this.database.db.select().from(brands).orderBy(brands.displayName),
			this.database.db
				.select()
				.from(competitorBrandSources)
				.orderBy(desc(competitorBrandSources.createdAt))
		]);

		const sourcesByBrand = new Map<string, typeof sourceRows>();
		for (const source of sourceRows) {
			const list = sourcesByBrand.get(source.brandId) ?? [];
			list.push(source);
			sourcesByBrand.set(source.brandId, list);
		}

		return brandRows.map((brand) => ({
			brand,
			sources: sourcesByBrand.get(brand.canonicalKey) ?? []
		}));
	}

	// Idempotent by design (upserts on the (competitorId, sourceUrl) unique
	// constraint) so the seed script and a repeated Admin "add" both behave
	// the same way: re-adding an existing URL updates it rather than
	// erroring or duplicating.
	async upsert(input: NewBrandSourceInput) {
		const [row] = await this.database.db
			.insert(competitorBrandSources)
			.values({
				brandId: input.brandId,
				competitorId: input.competitorId,
				sourceUrl: input.sourceUrl,
				status: input.status ?? 'needs_review',
				externalName: input.externalName ?? null
			})
			.onConflictDoUpdate({
				target: [competitorBrandSources.competitorId, competitorBrandSources.sourceUrl],
				set: {
					brandId: input.brandId,
					status: input.status ?? 'needs_review',
					externalName: input.externalName ?? null,
					updatedAt: new Date()
				}
			})
			.returning();

		return row;
	}

	async patch(id: number, patch: BrandSourcePatch) {
		const [row] = await this.database.db
			.update(competitorBrandSources)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(competitorBrandSources.id, id))
			.returning();

		if (!row) {
			throw new NotFoundException(`No competitor_brand_sources row with id ${id}`);
		}

		return row;
	}

	async remove(id: number) {
		const [row] = await this.database.db
			.delete(competitorBrandSources)
			.where(eq(competitorBrandSources.id, id))
			.returning();

		if (!row) {
			throw new NotFoundException(`No competitor_brand_sources row with id ${id}`);
		}

		return row;
	}
}
