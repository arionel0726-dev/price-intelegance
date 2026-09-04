import {
	boolean,
	index,
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core'

export const products = pgTable(
	'products',
	{
		id: serial('id').primaryKey(),

		// Raw source identifier (Vizaje/1C ID_nom), kept for traceability.
		// NOT globally unique in the source data - do not use for upserts.
		sourceId: text('source_id'),

		// Deterministic importer identity - see packages/db/scripts/import-vizaje.ts.
		// Equal to sourceId for ordinary rows; disambiguated with barcode (or a
		// field fingerprint) when raw ID_nom collides between distinct products.
		sourceKey: text('source_key').notNull(),

		// Raw VariativeNomenclature - groups sellable SKUs (e.g. volume/shade
		// ladders) for display/matching. Metadata only, does not affect identity.
		variantGroupId: text('variant_group_id'),

		article: text('article'),
		barcode: text('barcode'),

		brand: text('brand').notNull(),
		name: text('name').notNull(),
		category: text('category'),

		sex: text('sex'),
		volume: text('volume'),
		color: text('color'),

		imageUrl: text('image_url'),

		// Current customer-facing price (DiscountPrice when active, else Price).
		price: numeric('price', {
			precision: 10,
			scale: 2
		}),

		// Undiscounted list price, preserved alongside the current price.
		regularPrice: numeric('regular_price', {
			precision: 10,
			scale: 2
		}),

		// Canonical Vizaje-Nica website URL for this SKU's family page.
		url: text('url'),

		// Nullable, NOT default(true): null means "unknown/not yet verified from
		// the website" (e.g. legacy JSON-only rows). true/false means the
		// website sync explicitly observed this variant's availability.
		available: boolean('available'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [
		unique().on(table.sourceKey),
		// Simple, evidence-free indexes for the catalog list endpoint's
		// equality filters (brand/category) and sourceId search - not
		// pg_trgm/full-text, which isn't justified at this table size.
		index('products_brand_idx').on(table.brand),
		index('products_category_idx').on(table.category),
		index('products_source_id_idx').on(table.sourceId),
		// Catalog family grouping (GROUP BY variant_group_id) and the product
		// detail page's sibling-variant lookup - see ProductsService.
		index('products_variant_group_id_idx').on(table.variantGroupId)
	]
)

export const productBarcodes = pgTable(
	'product_barcodes',
	{
		id: serial('id').primaryKey(),

		productId: integer('product_id')
			.references(() => products.id)
			.notNull(),

		barcode: text('barcode').notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	table => [unique().on(table.barcode)]
)

export const competitors = pgTable(
	'competitors',
	{
		id: serial('id').primaryKey(),

		name: text('name').notNull(),
		domain: text('domain').notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	table => [unique().on(table.domain)]
)

export const competitorProducts = pgTable(
	'competitor_products',
	{
		id: serial('id').primaryKey(),

		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),

		externalId: text('external_id').notNull(),

		title: text('title').notNull(),
		brand: text('brand'),
		imageUrl: text('image_url'),
		url: text('url').notNull(),
		currency: text('currency').default('MDL').notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [unique().on(table.competitorId, table.externalId)]
)

export const competitorProductVariants = pgTable(
	'competitor_product_variants',
	{
		id: serial('id').primaryKey(),

		competitorProductId: integer('competitor_product_id')
			.references(() => competitorProducts.id)
			.notNull(),

		externalId: text('external_id').notNull(),

		label: text('label'),
		volume: text('volume'),

		price: numeric('price', {
			precision: 10,
			scale: 2
		}),

		available: boolean('available').default(true).notNull(),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [unique().on(table.competitorProductId, table.externalId)]
)

export const matches = pgTable(
	'matches',
	{
		id: serial('id').primaryKey(),

		productId: integer('product_id')
			.references(() => products.id)
			.notNull(),

		competitorProductVariantId: integer('competitor_product_variant_id')
			.references(() => competitorProductVariants.id)
			.notNull(),

		source: text('source').notNull(),
		score: integer('score'),

		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	table => [unique().on(table.productId, table.competitorProductVariantId)]
)

export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert

export type ProductBarcode = typeof productBarcodes.$inferSelect
export type NewProductBarcode = typeof productBarcodes.$inferInsert

export type Competitor = typeof competitors.$inferSelect
export type NewCompetitor = typeof competitors.$inferInsert

export type CompetitorProduct = typeof competitorProducts.$inferSelect
export type NewCompetitorProduct = typeof competitorProducts.$inferInsert

export type CompetitorProductVariant = typeof competitorProductVariants.$inferSelect
export type NewCompetitorProductVariant =
	typeof competitorProductVariants.$inferInsert

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
