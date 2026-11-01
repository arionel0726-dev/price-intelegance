import { Injectable } from '@nestjs/common';

import { competitorProductVariants, competitorProducts } from '@price/db';

import { DatabaseService } from '../../database/database.service';
import type { ParsedOvicoListingProduct } from './ovico-listing-parser';

export type CatalogUpsertOutcome = 'inserted' | 'updated';

// Catalog Ingestion v1 (OVICO) - deliberately separate from
// CompetitorPersistenceService (used by the existing per-SKU search/
// discovery path): same upsert SHAPE (onConflictDoUpdate on
// (competitorId, externalId)), but this one sets the catalog-ingestion-
// specific columns (brandId, active, firstSeenAt/lastSeenAt/lastSyncedAt,
// concentration, isApproximatePrice) that the per-SKU path never populates.
// Keeping this isolated means nothing here can regress the existing,
// already-shipped M1-M6 discovery/matching behavior.
@Injectable()
export class OvicoCatalogPersistenceService {
	constructor(private readonly database: DatabaseService) {}

	// v1 persists exactly one variant per product (see
	// ovico-listing-parser.ts's file comment on why: OVICO's brand-listing
	// page gives one price - either exact or an approximate "from" price
	// for the rare configurable product - never a full per-SKU/volume
	// breakdown without a product-detail fetch, which this milestone does
	// not implement). The variant's externalId reuses the product's
	// externalId; there is no separate per-SKU id visible on the listing.
	async upsertProduct(
		competitorId: number,
		brandId: string,
		parsed: ParsedOvicoListingProduct
	): Promise<{ outcome: CatalogUpsertOutcome; competitorProductId: number }> {
		const db = this.database.db
		const now = new Date()

		const [productRow] = await db
			.insert(competitorProducts)
			.values({
				competitorId,
				externalId: parsed.externalId,
				title: parsed.name,
				brand: parsed.brandLabel,
				imageUrl: parsed.imageUrl,
				url: parsed.url,
				brandId,
				active: true,
				firstSeenAt: now,
				lastSeenAt: now,
				lastSyncedAt: now
			})
			.onConflictDoUpdate({
				target: [competitorProducts.competitorId, competitorProducts.externalId],
				set: {
					title: parsed.name,
					brand: parsed.brandLabel,
					imageUrl: parsed.imageUrl,
					url: parsed.url,
					brandId,
					active: true,
					lastSeenAt: now,
					lastSyncedAt: now,
					updatedAt: now
				}
			})
			.returning({
				id: competitorProducts.id,
				firstSeenAt: competitorProducts.firstSeenAt
			})

		// firstSeenAt only equals `now` (this call's own timestamp) for a
		// genuinely new row - onConflictDoUpdate's SET above never touches
		// firstSeenAt, so an existing row's original value always survives.
		const outcome: CatalogUpsertOutcome =
			productRow.firstSeenAt.getTime() === now.getTime() ? 'inserted' : 'updated'

		const price = parsed.price != null ? parsed.price.toFixed(2) : null

		await db
			.insert(competitorProductVariants)
			.values({
				competitorProductId: productRow.id,
				externalId: parsed.externalId,
				label: parsed.concentration,
				concentration: parsed.concentration,
				price,
				isApproximatePrice: parsed.isApproximatePrice,
				available: true,
				lastSeenAt: now,
				lastSyncedAt: now
			})
			.onConflictDoUpdate({
				target: [
					competitorProductVariants.competitorProductId,
					competitorProductVariants.externalId
				],
				set: {
					label: parsed.concentration,
					concentration: parsed.concentration,
					price,
					isApproximatePrice: parsed.isApproximatePrice,
					available: true,
					lastSeenAt: now,
					lastSyncedAt: now,
					updatedAt: now
				}
			})

		return { outcome, competitorProductId: productRow.id }
	}
}
