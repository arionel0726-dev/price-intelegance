import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	unique,
	uniqueIndex
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

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

		// Catalog Ingestion v1 (OVICO) - nullable: only set by the brand-
		// catalog ingestion path, which always knows the canonical Vizaje
		// brand it's syncing for (see competitor_brand_sources.brandId).
		// Left NULL for rows persisted by the existing per-SKU search/
		// discovery path, which never resolves a canonical brand up front -
		// no attempt is made to backfill it from the free-text `brand`
		// column above, which is a raw site label, not a canonical key.
		brandId: text('brand_id').references(() => brands.canonicalKey),

		active: boolean('active').default(true).notNull(),
		// Defaulted to now() rather than left nullable so every row (old
		// search-discovered ones included) has a well-defined "first/last
		// seen" value from the moment this column exists, instead of a
		// silent NULL that every future freshness query would have to
		// special-case.
		firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
		lastSyncedAt: timestamp('last_synced_at'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [
		unique().on(table.competitorId, table.externalId),
		index('competitor_products_brand_id_idx').on(table.brandId)
	]
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

		// Catalog Ingestion v1 (OVICO) - no discount/old-price markup was
		// observed anywhere in the real brand-listing page this was built
		// against (see ovico-listing-parser.ts), so this is always NULL for
		// catalog-ingested rows today; kept nullable/additive so a future
		// milestone that does find discount markup (e.g. on the product
		// detail page) is an UPDATE, not another migration.
		oldPrice: numeric('old_price', {
			precision: 10,
			scale: 2
		}),

		// Fragrance concentration (e.g. "Парфюмерная вода") and shade, where
		// the source distinguishes them from the free-text `label`/`volume`
		// above. Both nullable/additive - unpopulated by the existing
		// per-SKU search/discovery path.
		concentration: text('concentration'),
		shade: text('shade'),

		available: boolean('available').default(true).notNull(),

		// true only for a catalog-ingested variant whose price is a listing
		// page's "от" (from)-prefixed lowest price for a multi-SKU
		// configurable product, not an exact single-SKU price - see
		// ovico-listing-parser.ts. Always false for every other row
		// (default, and for every row the existing search/discovery path
		// persists) so this never needs to be treated as "unknown".
		isApproximatePrice: boolean('is_approximate_price').default(false).notNull(),

		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
		lastSyncedAt: timestamp('last_synced_at'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [unique().on(table.competitorProductId, table.externalId)]
)

// Catalog Ingestion v1 (OVICO) - the persisted mapping from a canonical
// Vizaje brand to a competitor's own brand-listing page(s). Deliberately
// UNIQUE(competitorId, sourceUrl), NOT (brandId, competitorId): one
// canonical brand can have several source pages on the same competitor
// (e.g. OVICO splits Armani across /armani, /armani-beauty and
// /armani-prive) - see the milestone spec's brand-mapping examples.
export const competitorBrandSources = pgTable(
	'competitor_brand_sources',
	{
		id: serial('id').primaryKey(),

		brandId: text('brand_id')
			.references(() => brands.canonicalKey)
			.notNull(),
		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),

		sourceUrl: text('source_url').notNull(),
		externalName: text('external_name'),
		externalId: text('external_id'),

		enabled: boolean('enabled').default(true).notNull(),

		// 'confirmed' = a real, verified source page (what this milestone's
		// 26 known OVICO mappings all start as). 'missing' = the competitor
		// genuinely doesn't sell this brand - persisted explicitly so
		// nothing keeps re-searching for it forever (see spec). 'needs_review'
		// = found but ambiguous, awaiting human Admin confirmation. No
		// status here is ever set by an automatic frequency heuristic - same
		// human-confirmation discipline as known_placeholder_images above.
		status: text('status').notNull().default('needs_review'),

		lastSyncedAt: timestamp('last_synced_at'),
		lastSyncStatus: text('last_sync_status'),
		lastSyncError: text('last_sync_error'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [
		unique().on(table.competitorId, table.sourceUrl),
		index('competitor_brand_sources_brand_competitor_idx').on(
			table.brandId,
			table.competitorId
		),
		check(
			'competitor_brand_sources_status_check',
			sql`${table.status} IN ('confirmed', 'missing', 'needs_review')`
		)
	]
)

// Catalog Ingestion v1 (OVICO) - one row per brand-source sync attempt.
// Deliberately separate from job_runs/discoveryAttempts: a catalog sync
// crawls one brand-listing page end to end in one request, with no
// per-SKU claim/lease/heartbeat model to share - folding it into job_runs'
// counters would mean overloading their meaning for a fundamentally
// different kind of run (see spec point 16).
export const catalogSyncRuns = pgTable(
	'catalog_sync_runs',
	{
		id: serial('id').primaryKey(),

		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),
		brandSourceId: integer('brand_source_id')
			.references(() => competitorBrandSources.id)
			.notNull(),

		status: text('status').notNull().default('running'),

		pagesProcessed: integer('pages_processed').default(0).notNull(),
		discovered: integer('discovered').default(0).notNull(),
		inserted: integer('inserted').default(0).notNull(),
		updated: integer('updated').default(0).notNull(),
		skipped: integer('skipped').default(0).notNull(),
		errorCount: integer('error_count').default(0).notNull(),
		errorSummary: text('error_summary'),

		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at')
	},
	table => [
		check(
			'catalog_sync_runs_status_check',
			sql`${table.status} IN ('running', 'completed', 'failed')`
		),
		index('catalog_sync_runs_brand_source_idx').on(table.brandSourceId, table.startedAt)
	]
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

// ---------------------------------------------------------------------------
// Price Intelligence milestone 1 - policy, placeholder-image, and discovery
// persistence tables. See project architecture notes (Discovery/Jobs/AI-
// Review/Policy design) for the full rationale; this milestone only wires
// persistence + policy-aware selection through the existing CLI/cron path -
// no worker/poller, no AI calls yet (job_runs/job_events exist here purely
// for FK shape; nothing writes to them this milestone).
// ---------------------------------------------------------------------------

// Small, generic key/value store for true global runtime/business settings
// only (e.g. "is the AI review stage on at all", "what confidence auto-
// confirms a match") - deliberately NOT a dumping ground for per-job
// parameters (brand/limit/productBudgetSeconds live in job_runs.params) or
// operational pacing constants (those stay env vars, same as today's
// MAKEUP_COOLDOWN_WAIT_MS and friends).
export const appSettings = pgTable('app_settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// One row per canonical brand (canonicalBrand() output from
// matching-normalization.ts - see the invariant note there and in
// policy.service.ts). Dense: every brand encountered during Vizaje sync
// gets a row with all-enabled defaults, so an Admin "Brands" screen can list
// every brand without guessing defaults for ones nobody has touched yet.
//
// Deliberately NO master `discoveryEnabled` column: a discovery job always
// targets exactly one competitor, so a brand-wide "pause everything" state
// is already fully expressible as makeupDiscoveryEnabled=false AND
// ovicoDiscoveryEnabled=false - a third column could only ever restate that
// combination or (worse) silently disagree with it. An Admin "pause brand"
// button can set both concrete flags at once; it does not need its own
// column to do that.
export const brands = pgTable('brands', {
	canonicalKey: text('canonical_key').primaryKey(),
	displayName: text('display_name').notNull(),

	visibleInCatalog: boolean('visible_in_catalog').notNull().default(true),
	makeupDiscoveryEnabled: boolean('makeup_discovery_enabled').notNull().default(true),
	ovicoDiscoveryEnabled: boolean('ovico_discovery_enabled').notNull().default(true),
	priceMonitoringEnabled: boolean('price_monitoring_enabled').notNull().default(true),

	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Sparse - a row exists only where a product-level override was explicitly
// set. Tri-state: NULL = inherit from brand policy, true = force enabled,
// false = force disabled. Works in both directions (can force-enable a SKU
// whose brand is otherwise discovery-disabled, and vice versa) - see
// policy.service.ts for the precedence computation.
export const productPolicyOverrides = pgTable(
	'product_policy_overrides',
	{
		productId: integer('product_id')
			.references(() => products.id)
			.primaryKey(),

		catalogEnabledOverride: boolean('catalog_enabled_override'),
		// Single flag, not competitor-specific at the product level in this
		// milestone - see architecture notes. Brand-level stays competitor-
		// specific (makeupDiscoveryEnabled/ovicoDiscoveryEnabled above).
		discoveryEnabledOverride: boolean('discovery_enabled_override'),
		priceMonitoringEnabledOverride: boolean('price_monitoring_enabled_override'),

		// Meaningful primarily when an override is false (force-disable);
		// never required for a force-enable override.
		exclusionReason: text('exclusion_reason'),
		reasonNote: text('reason_note'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		updatedBy: text('updated_by')
	},
	table => [
		check(
			'product_policy_overrides_exclusion_reason_check',
			sql`${table.exclusionReason} IS NULL OR ${table.exclusionReason} IN ('duplicate', 'discontinued', 'bad_data', 'wrong_product', 'internal', 'other')`
		)
	]
)

// Explicit, human-confirmed registry only - see policy.service.ts /
// image-status.ts. A frequency analysis over products.image_url may
// SUGGEST candidates worth checking, but nothing here is ever inserted
// automatically by a count threshold.
export const knownPlaceholderImages = pgTable('known_placeholder_images', {
	imageUrl: text('image_url').primaryKey(),
	note: text('note'),
	confirmedAt: timestamp('confirmed_at').defaultNow().notNull(),
	confirmedBy: text('confirmed_by')
})

// Exists for FK shape only in this milestone - no worker/poller writes to
// this table yet (see jobs/* for the still-synchronous CLI/cron execution
// path actually in use). Added now so discoveryAttempts.lastJobRunId /
// discoveryCandidates.jobRunId have a real target instead of a dangling
// forward reference, avoiding a later non-additive FK migration.
export const jobRuns = pgTable(
	'job_runs',
	{
		id: serial('id').primaryKey(),

		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),
		jobType: text('job_type').notNull().default('discovery'),
		mode: text('mode').notNull(),

		status: text('status').notNull().default('queued'),

		params: jsonb('params').notNull(),

		stopRequested: boolean('stop_requested').notNull().default(false),
		stopRequestedAt: timestamp('stop_requested_at'),

		stopReason: text('stop_reason'),
		failureClass: text('failure_class'),

		eligibleAtStart: integer('eligible_at_start'),
		processedCount: integer('processed_count').notNull().default(0),
		autoCount: integer('auto_count').notNull().default(0),
		aiAutoCount: integer('ai_auto_count').notNull().default(0),
		aiReviewCount: integer('ai_review_count').notNull().default(0),
		noMatchCount: integer('no_match_count').notNull().default(0),
		errorCount: integer('error_count').notNull().default(0),
		retryCount: integer('retry_count').notNull().default(0),

		currentProductId: integer('current_product_id').references(() => products.id),
		currentProductStartedAt: timestamp('current_product_started_at'),

		workerId: text('worker_id'),
		heartbeatAt: timestamp('heartbeat_at'),

		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		error: text('error')
	},
	table => [
		check('job_runs_mode_check', sql`${table.mode} IN ('limited', 'continuous')`),
		check(
			'job_runs_status_check',
			sql`${table.status} IN ('queued', 'running', 'stopping', 'completed', 'failed', 'cancelled')`
		),
		check(
			'job_runs_failure_class_check',
			sql`${table.failureClass} IS NULL OR ${table.failureClass} IN ('operational', 'application')`
		),
		uniqueIndex('job_runs_active_per_competitor')
			.on(table.competitorId)
			.where(sql`${table.status} IN ('queued', 'running', 'stopping')`),
		index('job_runs_status_idx').on(table.status)
	]
)

// Per (Vizaje product, competitor) persistent discovery state. Absence of a
// row = "never_checked"; a confirmed match is represented ONLY by a row in
// `matches` - this table's row is deleted once that pair is matched, never
// left around duplicating "matched" as a status value. See
// discovery-state.service.ts.
export const discoveryAttempts = pgTable(
	'discovery_attempts',
	{
		id: serial('id').primaryKey(),

		productId: integer('product_id')
			.references(() => products.id)
			.notNull(),
		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),

		status: text('status').notNull(),

		attemptCount: integer('attempt_count').notNull().default(0),
		lastCheckedAt: timestamp('last_checked_at').notNull(),
		lastJobRunId: integer('last_job_run_id').references(() => jobRuns.id),
		lastError: text('last_error'),

		retryEligibleAt: timestamp('retry_eligible_at'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	table => [
		unique().on(table.productId, table.competitorId),
		check(
			'discovery_attempts_status_check',
			sql`${table.status} IN ('processing', 'no_match', 'pending_review', 'error')`
		),
		index('discovery_attempts_competitor_status_idx').on(table.competitorId, table.status),
		index('discovery_attempts_retry_idx').on(table.competitorId, table.retryEligibleAt),
		index('discovery_attempts_last_job_run_idx').on(table.lastJobRunId)
	]
)

// Deterministic-ambiguous candidate awaiting future AI/manual review. A
// real competitor_product_variants row always backs this (persisted via
// CompetitorPersistenceService exactly like an auto match would be) -
// the snapshot* columns freeze what the reviewer saw at discovery time so a
// later price refresh on that variant can't silently change what's shown on
// an open review item. See discovery-state.service.ts / policy notes for
// why `reviewStatus='pending'` + `aiVerdict IS NULL` is this milestone's
// safe "not lost, not auto-approved" representation for a deterministic
// ambiguous outcome before the AI stage exists.
export const discoveryCandidates = pgTable(
	'discovery_candidates',
	{
		id: serial('id').primaryKey(),

		productId: integer('product_id')
			.references(() => products.id)
			.notNull(),
		competitorId: integer('competitor_id')
			.references(() => competitors.id)
			.notNull(),
		competitorProductVariantId: integer('competitor_product_variant_id')
			.references(() => competitorProductVariants.id)
			.notNull(),
		jobRunId: integer('job_run_id').references(() => jobRuns.id),

		snapshotTitle: text('snapshot_title').notNull(),
		snapshotVariantLabel: text('snapshot_variant_label'),
		snapshotVariantVolume: text('snapshot_variant_volume'),
		snapshotPrice: numeric('snapshot_price', { precision: 10, scale: 2 }),
		snapshotUrl: text('snapshot_url').notNull(),
		snapshotImageUrl: text('snapshot_image_url'),

		ruleScore: integer('rule_score').notNull(),
		// Text, not a tight enum - 'ambiguous' is the only value this
		// milestone produces, left open for a possible future no_match->AI
		// fallback path without a migration.
		ruleDecision: text('rule_decision').notNull(),
		ruleSignals: jsonb('rule_signals').notNull(),

		// AI fields all stay NULL in this milestone - no DeepSeek call exists
		// yet. Columns created now so the AI milestone is additive (UPDATE
		// only, no new columns) rather than another schema change.
		aiVerdict: text('ai_verdict'),
		aiConfidence: numeric('ai_confidence', { precision: 3, scale: 2 }),
		aiReason: text('ai_reason'),
		aiRawResponse: jsonb('ai_raw_response'),
		aiEvaluatedAt: timestamp('ai_evaluated_at'),
		aiThresholdUsed: numeric('ai_threshold_used', { precision: 3, scale: 2 }),

		// Milestone 3 - usage/cost telemetry, captured per DeepSeek call when
		// the provider returns them. All nullable: never populated for a
		// candidate AI never actually evaluated (disabled, or a parse/
		// network failure before any usage was returned).
		aiModel: text('ai_model'),
		aiPromptTokens: integer('ai_prompt_tokens'),
		aiCompletionTokens: integer('ai_completion_tokens'),
		aiTotalTokens: integer('ai_total_tokens'),
		aiLatencyMs: integer('ai_latency_ms'),
		// Estimated only - derived from a configurable price-per-token
		// constant (see ai/deepseek-pricing.ts), never a billed figure.
		aiEstimatedCostUsd: numeric('ai_estimated_cost_usd', { precision: 10, scale: 6 }),

		// Claim/lease marker for DiscoveryAiReviewService.processPendingBatch()
		// - same shape as job_runs.heartbeatAt: set when a batch run claims
		// this row, cleared when that run reaches a terminal outcome for it
		// (resolved OR left pending) so the row is immediately reclaimable
		// again; a lease older than AI_REVIEW_PROCESSING_LEASE_MS is treated
		// as abandoned (a crashed/killed batch run) and reclaimable too.
		// NULL for every row the synchronous in-job AI path produces -
		// batch claiming only matters for the out-of-band processor.
		aiProcessingAt: timestamp('ai_processing_at'),

		reviewStatus: text('review_status').notNull().default('not_required'),
		reviewedAt: timestamp('reviewed_at'),
		reviewedBy: text('reviewed_by'),
		reviewNote: text('review_note'),

		outcome: text('outcome'),
		resolvedAt: timestamp('resolved_at'),

		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	table => [
		unique().on(table.productId, table.competitorId, table.competitorProductVariantId),
		check(
			'discovery_candidates_ai_verdict_check',
			sql`${table.aiVerdict} IS NULL OR ${table.aiVerdict} IN ('approve', 'reject')`
		),
		check(
			'discovery_candidates_review_status_check',
			sql`${table.reviewStatus} IN ('not_required', 'pending', 'approved', 'rejected')`
		),
		check(
			'discovery_candidates_outcome_check',
			sql`${table.outcome} IS NULL OR ${table.outcome} IN ('ai_auto_matched', 'manual_approved', 'manual_rejected')`
		),
		index('discovery_candidates_pending_idx')
			.on(table.competitorId)
			.where(sql`${table.reviewStatus} = 'pending'`),
		index('discovery_candidates_job_run_idx').on(table.jobRunId),
		// Milestone 3 - the exact predicate DiscoveryAiReviewService.
		// processPendingBatch() claims against (unevaluated-pending rows,
		// oldest first via id).
		index('discovery_candidates_ai_claim_idx')
			.on(table.id)
			.where(sql`${table.reviewStatus} = 'pending' AND ${table.aiVerdict} IS NULL`)
	]
)

// Exists for FK shape only in this milestone - see jobRuns comment above.
// Nothing writes to this table yet.
export const jobEvents = pgTable(
	'job_events',
	{
		id: serial('id').primaryKey(),

		jobRunId: integer('job_run_id')
			.references(() => jobRuns.id)
			.notNull(),
		productId: integer('product_id').references(() => products.id),

		eventType: text('event_type').notNull(),
		message: text('message'),
		data: jsonb('data'),

		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	table => [index('job_events_job_run_idx').on(table.jobRunId, table.createdAt)]
)

export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert

export type Brand = typeof brands.$inferSelect
export type NewBrand = typeof brands.$inferInsert

export type ProductPolicyOverride = typeof productPolicyOverrides.$inferSelect
export type NewProductPolicyOverride = typeof productPolicyOverrides.$inferInsert

export type KnownPlaceholderImage = typeof knownPlaceholderImages.$inferSelect
export type NewKnownPlaceholderImage = typeof knownPlaceholderImages.$inferInsert

export type JobRun = typeof jobRuns.$inferSelect
export type NewJobRun = typeof jobRuns.$inferInsert

export type DiscoveryAttempt = typeof discoveryAttempts.$inferSelect
export type NewDiscoveryAttempt = typeof discoveryAttempts.$inferInsert

export type DiscoveryCandidate = typeof discoveryCandidates.$inferSelect
export type NewDiscoveryCandidate = typeof discoveryCandidates.$inferInsert

export type JobEvent = typeof jobEvents.$inferSelect
export type NewJobEvent = typeof jobEvents.$inferInsert

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

export type CompetitorBrandSource = typeof competitorBrandSources.$inferSelect
export type NewCompetitorBrandSource = typeof competitorBrandSources.$inferInsert

export type CatalogSyncRun = typeof catalogSyncRuns.$inferSelect
export type NewCatalogSyncRun = typeof catalogSyncRuns.$inferInsert

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
