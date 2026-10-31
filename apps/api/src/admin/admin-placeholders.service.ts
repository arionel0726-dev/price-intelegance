import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, desc, eq, knownPlaceholderImages, products, sql } from '@price/db';

import { DatabaseService } from '../database/database.service';

// Same Postgres unique_violation convention as discovery-jobs.service.ts's
// POSTGRES_UNIQUE_VIOLATION check - a duplicate POST must surface as a
// clean 409, never a raw driver error.
const POSTGRES_UNIQUE_VIOLATION = '23505';

export type PlaceholderCandidatesThreshold = number;

@Injectable()
export class AdminPlaceholdersService {
	constructor(private readonly database: DatabaseService) {}

	// Affected-product-count per URL - the registry is small (one row per
	// confirmed placeholder URL), so a per-row correlated count subquery is
	// cheap here, unlike a per-page computation over the whole catalog.
	//
	// IMPORTANT: both sides of the subquery's WHERE are written as fully
	// literal, hand-qualified identifiers ("p.image_url" /
	// "known_placeholder_images.image_url") - NEITHER side interpolates a
	// drizzle column object (${products.imageUrl} etc). Interpolating
	// `${someColumn}` renders only the bare, unqualified column name (by
	// design - drizzle trusts ordinary SQL scoping for a plain top-level
	// reference); that is wrong here specifically because this is a
	// correlated subquery where inner and outer both have a column
	// literally named `image_url` - Postgres resolves ANY unqualified
	// `image_url` to the innermost scope that has it, silently turning the
	// comparison into a self-referential tautology (every row with a
	// non-null image_url counted, for every registry row, regardless of
	// which URL). This was verified directly (toSQL() + a live query
	// showing affectedProductCount return the total non-null-image product
	// count instead of the per-URL count) before landing on fully literal
	// qualification as the fix - a partial fix (giving only the inner
	// table an alias while still interpolating the outer column object)
	// was NOT sufficient, since the outer `${knownPlaceholderImages.
	// imageUrl}` interpolation still rendered unqualified and still got
	// swallowed by the inner scope.
	async list() {
		return this.database.db
			.select({
				imageUrl: knownPlaceholderImages.imageUrl,
				note: knownPlaceholderImages.note,
				confirmedAt: knownPlaceholderImages.confirmedAt,
				confirmedBy: knownPlaceholderImages.confirmedBy,
				affectedProductCount: sql<number>`(
					select count(*) from ${products} as p where p.image_url = known_placeholder_images.image_url
				)`.mapWith(Number),
			})
			.from(knownPlaceholderImages)
			.orderBy(desc(knownPlaceholderImages.confirmedAt));
	}

	// Duplicate add (the same imageUrl confirmed twice) returns a clean 409
	// naming the existing confirmation, never a raw Postgres
	// unique-violation - same shape as discovery-jobs.service.ts's enqueue()
	// 409 handling.
	async add(imageUrl: string, note: string | null, confirmedBy: string | null) {
		try {
			const [row] = await this.database.db.insert(knownPlaceholderImages).values({ imageUrl, note, confirmedBy }).returning();
			return row!;
		} catch (error) {
			const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
			if (code === POSTGRES_UNIQUE_VIOLATION) {
				throw new ConflictException(`"${imageUrl}" is already a confirmed placeholder image`);
			}
			throw error;
		}
	}

	async updateNote(imageUrl: string, note: string | null) {
		const [row] = await this.database.db
			.update(knownPlaceholderImages)
			.set({ note })
			.where(eq(knownPlaceholderImages.imageUrl, imageUrl))
			.returning();

		if (!row) throw new NotFoundException(`"${imageUrl}" is not a confirmed placeholder image`);
		return row;
	}

	// Removes ONLY the registry row - never touches products/imageUrl. A
	// product whose imageUrl matches the removed URL simply reclassifies as
	// "real" (or stays "missing" if it was never set) on the very next
	// catalog/data-quality read, since classification is a live SQL
	// predicate, not a cached/denormalized flag.
	async remove(imageUrl: string) {
		const [row] = await this.database.db.delete(knownPlaceholderImages).where(eq(knownPlaceholderImages.imageUrl, imageUrl)).returning();
		if (!row) throw new NotFoundException(`"${imageUrl}" is not a confirmed placeholder image`);
	}

	// Read-only diagnostic - NEVER inserts into known_placeholder_images.
	// Groups products by imageUrl (excluding already-confirmed placeholder
	// URLs, since suggesting one again is noise), counts occurrences,
	// surfaces only URLs at/above the caller-supplied threshold (no silent
	// hardcoded business rule - see Milestone 5 brief) with a small sample
	// of affected products per URL.
	async candidates(threshold: PlaceholderCandidatesThreshold, sampleSize = 5) {
		const confirmedUrls = this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages);

		const grouped = await this.database.db
			.select({ imageUrl: products.imageUrl, occurrences: count() })
			.from(products)
			.where(sql`${products.imageUrl} is not null`)
			.groupBy(products.imageUrl)
			.having(sql`count(*) >= ${threshold}`)
			.orderBy(desc(count()));

		const candidateUrls = grouped
			.map(row => row.imageUrl)
			.filter((url): url is string => url !== null);

		if (candidateUrls.length === 0) return [];

		// Re-check against the live confirmed set in JS rather than a second
		// SQL round trip per candidate - the registry is small.
		const confirmedSet = new Set((await confirmedUrls).map(row => row.imageUrl));
		const unconfirmed = grouped.filter(row => row.imageUrl !== null && !confirmedSet.has(row.imageUrl));

		const samples = await Promise.all(
			unconfirmed.map(async row => {
				const sample = await this.database.db
					.select({ id: products.id, brand: products.brand, name: products.name })
					.from(products)
					.where(eq(products.imageUrl, row.imageUrl!))
					.orderBy(asc(products.id))
					.limit(sampleSize);

				return { imageUrl: row.imageUrl!, occurrences: Number(row.occurrences), sample };
			}),
		);

		return samples;
	}
}
