// The one place products.imageUrl is classified into missing/placeholder/
// real - the EXACT M1 rule already enforced by ProductsService.buildWhere's
// catalog-visibility conditions (isNull -> missing; present in
// known_placeholder_images -> placeholder; else real), just also exposed as
// a label for Admin/Data Quality instead of only a hide/show boolean.
// Nothing here changes what the ordinary catalog listing hides - that logic
// in buildWhere is untouched; this is an additional read, not a
// replacement.
//
// Deliberately a plain JS function over a pre-loaded Set of confirmed
// placeholder URLs, NOT a SQL CASE/EXISTS expression computed in Postgres.
// An earlier version of this file built the classification as a raw `sql`
// correlated-subquery CASE expression; it worked in isolation but broke
// silently (verified directly with toSQL() + live queries, see
// verify-milestone5-admin.ts) whenever it had to coexist with another
// query referencing known_placeholder_images (either the same expression
// used twice in one query, or a second, independent subquery filtering by
// image state in the same WHERE clause) - a drizzle-orm 0.45.2 rendering
// quirk where an interpolated `${column}` reference renders unqualified,
// which Postgres then resolves to whichever scope is nearest once two
// same-named `image_url` columns are both in play, silently turning a
// correlated comparison into a self-referential tautology. known_
// placeholder_images is small (a human-curated registry, not a bulk
// table), so loading it once per request and classifying in JS - the same
// "small table, load once, filter in JS" shape PolicyContext and
// resolveHiddenRawBrands already use - is both correct and cheap, and
// sidesteps the whole class of bug rather than chasing another SQL
// rewrite.
import { knownPlaceholderImages } from '@price/db';

import { DatabaseService } from '../database/database.service';

export type ImageStatus = 'missing' | 'placeholder' | 'real';

export function classifyImageStatus(imageUrl: string | null, placeholderUrls: ReadonlySet<string>): ImageStatus {
	if (imageUrl === null) return 'missing';
	return placeholderUrls.has(imageUrl) ? 'placeholder' : 'real';
}

export async function loadPlaceholderUrlSet(database: DatabaseService): Promise<Set<string>> {
	const rows = await database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages);
	return new Set(rows.map(row => row.imageUrl));
}
