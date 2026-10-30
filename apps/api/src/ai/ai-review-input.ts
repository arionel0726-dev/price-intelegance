import { competitorProductVariants, competitorProducts, eq, products, type DbOrTx, type DiscoveryCandidate } from '@price/db';

import { DatabaseService } from '../database/database.service';
import type { MatchSignals } from '../matching/matching.types';
import type { DeepseekReviewInput } from './deepseek-review.types';

// Builds the exact input DeepseekReviewerService sends - Vizaje fields
// from `products` (only ones actually present, see
// DeepseekReviewVizajeInput's doc comment for the color->shade mapping and
// the omitted concentration/variant fields), competitor fields mostly
// already snapshotted on the candidate row itself (Milestone 1 - see
// discovery_candidates.snapshot*), plus ONE join for the competitor's
// brand, which was never snapshotted. ruleScore/ruleSignals are reused
// verbatim from the candidate row - never recomputed.
export async function buildReviewInputForCandidate(
	database: DatabaseService,
	candidate: DiscoveryCandidate,
	tx?: DbOrTx
): Promise<DeepseekReviewInput> {
	const db = tx ?? database.db;

	const [vizaje] = await db
		.select({
			brand: products.brand,
			name: products.name,
			article: products.article,
			barcode: products.barcode,
			volume: products.volume,
			color: products.color
		})
		.from(products)
		.where(eq(products.id, candidate.productId));

	if (!vizaje) {
		throw new Error(`products row ${candidate.productId} not found for discovery_candidates ${candidate.id}`);
	}

	const [competitorBrandRow] = await db
		.select({ brand: competitorProducts.brand })
		.from(competitorProductVariants)
		.innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
		.where(eq(competitorProductVariants.id, candidate.competitorProductVariantId));

	return {
		vizaje: {
			brand: vizaje.brand,
			name: vizaje.name,
			article: vizaje.article,
			barcode: vizaje.barcode,
			volume: vizaje.volume,
			shade: vizaje.color
		},
		competitor: {
			title: candidate.snapshotTitle,
			brand: competitorBrandRow?.brand ?? null,
			variantLabel: candidate.snapshotVariantLabel,
			variantVolume: candidate.snapshotVariantVolume,
			price: candidate.snapshotPrice,
			url: candidate.snapshotUrl
		},
		ruleScore: candidate.ruleScore,
		ruleSignals: candidate.ruleSignals as MatchSignals
	};
}
