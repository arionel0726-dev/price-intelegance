export * from './client.js'
export * from './schema.js'
export * from './vizaje-barcode.js'

import type { Database } from './client.js'

// Either the base connection or an open drizzle transaction handle - lets a
// service accept an optional `tx` from a caller that wants its write to
// join an existing transaction, while still defaulting to its own
// connection when called standalone. Both sides of the union expose the
// same insert/update/select/delete query-builder surface.
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

export {
	and,
	asc,
	avg,
	count,
	countDistinct,
	desc,
	eq,
	exists,
	gt,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	not,
	notInArray,
	or,
	sql,
	sum,
	type SQL
} from 'drizzle-orm'
