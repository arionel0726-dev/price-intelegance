import {
	boolean,
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core'

export const products = pgTable('products', {
	id: serial('id').primaryKey(),

	article: text('article'),
	barcode: text('barcode'),

	brand: text('brand').notNull(),
	name: text('name').notNull(),
	category: text('category'),

	sex: text('sex'),
	volume: text('volume'),
	color: text('color'),

	imageUrl: text('image_url'),

	price: numeric('price', {
		precision: 10,
		scale: 2
	}),

	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
})

export const competitors = pgTable('competitors', {
	id: serial('id').primaryKey(),

	name: text('name').notNull(),
	domain: text('domain').notNull(),

	createdAt: timestamp('created_at').defaultNow().notNull()
})

export const competitorProducts = pgTable('competitor_products', {
	id: serial('id').primaryKey(),

	competitorId: integer('competitor_id')
		.references(() => competitors.id)
		.notNull(),

	title: text('title').notNull(),
	imageUrl: text('image_url'),

	price: numeric('price', {
		precision: 10,
		scale: 2
	}),

	url: text('url').notNull(),

	available: boolean('available').default(true).notNull(),

	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
})

export const matches = pgTable('matches', {
	id: serial('id').primaryKey(),

	productId: integer('product_id')
		.references(() => products.id)
		.notNull(),

	competitorProductId: integer('competitor_product_id')
		.references(() => competitorProducts.id)
		.notNull(),

	source: text('source').notNull(),
	score: integer('score'),

	createdAt: timestamp('created_at').defaultNow().notNull()
})

export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert

export type Competitor = typeof competitors.$inferSelect
export type NewCompetitor = typeof competitors.$inferInsert

export type CompetitorProduct = typeof competitorProducts.$inferSelect
export type NewCompetitorProduct = typeof competitorProducts.$inferInsert

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
