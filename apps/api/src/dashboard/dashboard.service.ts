import { Injectable } from '@nestjs/common';
import {
	and,
	competitorProductVariants,
	competitorProducts,
	competitors,
	count,
	countDistinct,
	discoveryAttempts,
	discoveryCandidates,
	eq,
	inArray,
	isNotNull,
	lte,
	matches,
	products,
	sql
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { PolicyService } from '../policy/policy.service';
import { eligibleMonitoredCondition, resolvePriceMonitoringDisabledRawBrands } from './dashboard-eligibility';
import { computeGap, EQUAL_TOLERANCE_PERCENT, type PriceGap, type PricePosition } from './price-gap';

export type CompetitorFilter = 'all' | 'makeup' | 'ovico';

// Only these 3 values are ever written to matches.source (see
// matching.service.ts's MatchSource type and persistMatch - the only
// insert site for this table). No DB check constraint enforces this (a
// plain text column), so every dashboard query filters on it explicitly
// rather than assuming "a row in matches is automatically confirmed" -
// see verify-milestone6-dashboard.ts for a test that actually proves no
// other value exists among this script's own fixtures.
//
// A prior investigation (Milestone 6 follow-up) found 3 real rows with
// source='algorithm' - traced to packages/db/src/seed.ts's dev-seed
// script, which used that as its own ad-hoc label for an automated/
// scored match (semantically identical to 'auto') and was never a value
// the real matching code produced (matching.service.ts has only ever
// written 'auto', confirmed back to this repo's first commit). Fixed by
// drizzle/0010_fix_legacy_algorithm_match_source.sql (UPDATE matches SET
// source='auto' WHERE source='algorithm') and by correcting seed.ts so
// re-seeding never reintroduces it. This constant's set of 3 values
// remains correct and complete after that fix - documented here as the
// one place this was ever a concern, rather than special-cased at
// multiple query sites.
const CONFIRMED_MATCH_SOURCES = ['auto', 'ai', 'manual'] as const;

type EligibleRow = {
	id: number;
	brand: string;
	name: string;
	category: string | null;
	vizajePrice: string | null;
	makeupPrice: string | null;
	ovicoPrice: string | null;
};

type DerivedRow = EligibleRow & {
	vizajePriceNum: number | null;
	makeupPriceNum: number | null;
	ovicoPriceNum: number | null;
	hasMakeupMatch: boolean;
	hasOvicoMatch: boolean;
	hasAnyMatch: boolean;
	hasBothMatch: boolean;
	// The competitor price actually used for THIS row's gap, resolved per
	// the active competitor filter (see resolveRelevantCompetitorPrice).
	relevantCompetitorPrice: number | null;
	relevantCompetitorSource: 'makeup' | 'ovico' | null;
	isComparable: boolean;
	gap: PriceGap | null;
};

function toNum(value: string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

// "All" mode compares Vizaje against the LOWEST of its available
// confirmed competitor prices (documented choice per the M6 brief - a
// manager scanning "All" wants to know the toughest comparison, not an
// average of two unrelated competitors' prices). A specific competitor
// filter ('makeup'/'ovico') uses ONLY that competitor's price, even if
// the other competitor also has a match.
function resolveRelevantCompetitorPrice(
	competitor: CompetitorFilter,
	makeupPrice: number | null,
	ovicoPrice: number | null
): { price: number | null; source: 'makeup' | 'ovico' | null } {
	if (competitor === 'makeup') return { price: makeupPrice, source: makeupPrice !== null ? 'makeup' : null };
	if (competitor === 'ovico') return { price: ovicoPrice, source: ovicoPrice !== null ? 'ovico' : null };

	if (makeupPrice !== null && ovicoPrice !== null) {
		return makeupPrice <= ovicoPrice ? { price: makeupPrice, source: 'makeup' } : { price: ovicoPrice, source: 'ovico' };
	}
	if (makeupPrice !== null) return { price: makeupPrice, source: 'makeup' };
	if (ovicoPrice !== null) return { price: ovicoPrice, source: 'ovico' };
	return { price: null, source: null };
}

function deriveRow(row: EligibleRow, competitor: CompetitorFilter): DerivedRow {
	const vizajePriceNum = toNum(row.vizajePrice);
	const makeupPriceNum = toNum(row.makeupPrice);
	const ovicoPriceNum = toNum(row.ovicoPrice);

	const { price: relevantCompetitorPrice, source: relevantCompetitorSource } = resolveRelevantCompetitorPrice(competitor, makeupPriceNum, ovicoPriceNum);

	// Comparable-price universe: both sides present AND > 0 (see
	// dashboard-eligibility.ts's doc comment - null/zero/negative prices
	// are excluded, never treated as "free"/"equal").
	const isComparable = vizajePriceNum !== null && vizajePriceNum > 0 && relevantCompetitorPrice !== null && relevantCompetitorPrice > 0;

	return {
		...row,
		vizajePriceNum,
		makeupPriceNum,
		ovicoPriceNum,
		hasMakeupMatch: makeupPriceNum !== null,
		hasOvicoMatch: ovicoPriceNum !== null,
		hasAnyMatch: makeupPriceNum !== null || ovicoPriceNum !== null,
		hasBothMatch: makeupPriceNum !== null && ovicoPriceNum !== null,
		relevantCompetitorPrice,
		relevantCompetitorSource,
		isComparable,
		gap: isComparable ? computeGap(vizajePriceNum!, relevantCompetitorPrice!) : null
	};
}

function median(sorted: number[]): number | null {
	if (sorted.length === 0) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// 7 symmetric buckets centered on the ±1% equal-tolerance band. The M6
// brief refers to "the 7 specified buckets" without giving their exact
// boundaries in this conversation, so this is a documented judgment call
// (see the Milestone 6 report), not a value carried over from an earlier
// spec I had access to.
const GAP_BUCKETS: Array<{ key: string; label: string; min: number; max: number }> = [
	{ key: 'much_cheaper', label: 'Much cheaper (< -20%)', min: -Infinity, max: -20 },
	{ key: 'cheaper_10_20', label: 'Cheaper (-20% to -10%)', min: -20, max: -10 },
	{ key: 'cheaper_1_10', label: 'Cheaper (-10% to -1%)', min: -10, max: -EQUAL_TOLERANCE_PERCENT },
	{ key: 'approximately_equal', label: 'Approximately equal (±1%)', min: -EQUAL_TOLERANCE_PERCENT, max: EQUAL_TOLERANCE_PERCENT },
	{ key: 'more_expensive_1_10', label: 'More expensive (+1% to +10%)', min: EQUAL_TOLERANCE_PERCENT, max: 10 },
	{ key: 'more_expensive_10_20', label: 'More expensive (+10% to +20%)', min: 10, max: 20 },
	{ key: 'much_more_expensive', label: 'Much more expensive (> +20%)', min: 20, max: Infinity }
];

// Buckets are [min, max) half-open, EXCEPT the approximately_equal
// bucket which is [-1, +1] fully closed - matching computeGap's own
// `<= EQUAL_TOLERANCE_PERCENT` boundary exactly, so a row's bucket and
// its `position` field never disagree about where the ±1% line falls.
function bucketFor(gapPercent: number): string {
	if (gapPercent >= -EQUAL_TOLERANCE_PERCENT && gapPercent <= EQUAL_TOLERANCE_PERCENT) return 'approximately_equal';
	for (const bucket of GAP_BUCKETS) {
		if (bucket.key === 'approximately_equal') continue;
		if (gapPercent >= bucket.min && gapPercent < bucket.max) return bucket.key;
	}
	return gapPercent < 0 ? GAP_BUCKETS[0]!.key : GAP_BUCKETS[GAP_BUCKETS.length - 1]!.key;
}

@Injectable()
export class DashboardService {
	constructor(
		private readonly database: DatabaseService,
		private readonly policy: PolicyService
	) {}

	// The one bounded fetch every endpoint below builds on: every eligible
	// monitored product, LEFT JOINed to its own confirmed MAKEUP/OVICO
	// match price (if any) via two small GROUP BY CTEs - never a per-row
	// or per-brand loop. At this catalog's scale (website-confirmed
	// products, a dense but modest table - see products_brand_idx etc.)
	// this is one query, and all the aggregation below (brand grouping,
	// median, pagination) happens in JS over its result, which is simpler
	// and safer than composing percentile_cont across two LEFT JOINed
	// CTEs - see the Milestone 6 report for the measured timing and the
	// explicit trade-off this choice makes.
	private async loadEligibleRows(): Promise<EligibleRow[]> {
		const disabledRawBrands = await resolvePriceMonitoringDisabledRawBrands(this.database, this.policy);
		const where = eligibleMonitoredCondition(this.database, disabledRawBrands);

		// Each CTE's price column gets a DISTINCT name ('makeup_price' /
		// 'ovico_price', not both 'price') - selecting both in the same
		// outer query with the same bare column name is a genuine SQL
		// ambiguity (Postgres rejects it outright: "column reference
		// 'price' is ambiguous"), caught directly while smoke-testing this
		// query before any test was written.
		const makeupMatch = this.database.db.$with('makeup_match').as(
			this.database.db
				.select({ productId: matches.productId, makeupPrice: sql<string>`min(${competitorProductVariants.price})`.as('makeup_price') })
				.from(matches)
				.innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
				.innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
				.innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
				.where(and(eq(competitors.domain, 'makeup.md'), inArray(matches.source, CONFIRMED_MATCH_SOURCES)))
				.groupBy(matches.productId)
		);

		const ovicoMatch = this.database.db.$with('ovico_match').as(
			this.database.db
				.select({ productId: matches.productId, ovicoPrice: sql<string>`min(${competitorProductVariants.price})`.as('ovico_price') })
				.from(matches)
				.innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
				.innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
				.innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
				.where(and(eq(competitors.domain, 'ovico.md'), inArray(matches.source, CONFIRMED_MATCH_SOURCES)))
				.groupBy(matches.productId)
		);

		return this.database.db
			.with(makeupMatch, ovicoMatch)
			.select({
				id: products.id,
				brand: products.brand,
				name: products.name,
				category: products.category,
				vizajePrice: products.price,
				makeupPrice: makeupMatch.makeupPrice,
				ovicoPrice: ovicoMatch.ovicoPrice
			})
			.from(products)
			.leftJoin(makeupMatch, eq(makeupMatch.productId, products.id))
			.leftJoin(ovicoMatch, eq(ovicoMatch.productId, products.id))
			.where(where);
	}

	async getSummary(competitor: CompetitorFilter) {
		const rows = (await this.loadEligibleRows()).map(row => deriveRow(row, competitor));

		const eligibleMonitoredProducts = rows.length;
		const productCoverage = rows.filter(r => r.hasAnyMatch).length;
		const makeupCoverage = rows.filter(r => r.hasMakeupMatch).length;
		const ovicoCoverage = rows.filter(r => r.hasOvicoMatch).length;
		const bothCoverage = rows.filter(r => r.hasBothMatch).length;
		// Offer coverage = total confirmed match rows among eligible
		// products - can exceed productCoverage (a product matched to
		// both competitors counts twice here, never in productCoverage).
		const offerCoverage = makeupCoverage + ovicoCoverage;

		const comparableRows = rows.filter(r => r.isComparable);
		const comparableProducts = comparableRows.length;

		const positionCounts: Record<PricePosition, number> = { more_expensive: 0, cheaper: 0, approximately_equal: 0 };
		const bucketCounts: Record<string, number> = {};
		for (const bucket of GAP_BUCKETS) bucketCounts[bucket.key] = 0;
		const gapPercents: number[] = [];

		for (const row of comparableRows) {
			positionCounts[row.gap!.position] += 1;
			bucketCounts[bucketFor(row.gap!.gapPercent)] = (bucketCounts[bucketFor(row.gap!.gapPercent)] ?? 0) + 1;
			gapPercents.push(row.gap!.gapPercent);
		}

		const pct = (n: number, denom: number) => (denom > 0 ? (n / denom) * 100 : 0);

		return {
			competitor,
			universe: { eligibleMonitoredProducts, comparableProducts },
			coverage: {
				productCoverage,
				offerCoverage,
				makeupCoverage,
				ovicoCoverage,
				bothCoverage,
				coveragePercent: pct(productCoverage, eligibleMonitoredProducts)
			},
			pricePosition: {
				moreExpensive: positionCounts.more_expensive,
				cheaper: positionCounts.cheaper,
				approximatelyEqual: positionCounts.approximately_equal,
				moreExpensivePercent: pct(positionCounts.more_expensive, comparableProducts),
				cheaperPercent: pct(positionCounts.cheaper, comparableProducts),
				approximatelyEqualPercent: pct(positionCounts.approximately_equal, comparableProducts)
			},
			gapDistribution: GAP_BUCKETS.map(bucket => ({ key: bucket.key, label: bucket.label, count: bucketCounts[bucket.key] ?? 0 })),
			avgGapPercent: average(gapPercents),
			medianGapPercent: median([...gapPercents].sort((a, b) => a - b))
		};
	}

	async getBrands(competitor: CompetitorFilter, sort: string | undefined) {
		const rows = (await this.loadEligibleRows()).map(row => deriveRow(row, competitor));

		const byBrand = new Map<string, DerivedRow[]>();
		for (const row of rows) {
			const list = byBrand.get(row.brand) ?? [];
			list.push(row);
			byBrand.set(row.brand, list);
		}

		const items = Array.from(byBrand.entries()).map(([brand, brandRows]) => {
			const eligible = brandRows.length;
			const covered = brandRows.filter(r => r.hasAnyMatch).length;
			const comparable = brandRows.filter(r => r.isComparable);
			const gapPercents = comparable.map(r => r.gap!.gapPercent).sort((a, b) => a - b);

			return {
				brand,
				eligible,
				covered,
				coveragePercent: eligible > 0 ? (covered / eligible) * 100 : 0,
				comparable: comparable.length,
				avgGapPercent: average(gapPercents),
				medianGapPercent: median(gapPercents),
				unresolved: eligible - covered
			};
		});

		const sortKey = (sort ?? 'brand') as keyof (typeof items)[number];
		items.sort((a, b) => {
			const av = a[sortKey];
			const bv = b[sortKey];
			if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
			return ((bv as number) ?? -Infinity) - ((av as number) ?? -Infinity);
		});

		return { items };
	}

	async getOpportunities(options: {
		competitor: CompetitorFilter;
		brand?: string;
		position?: PricePosition;
		sort?: 'gapPercent' | 'gapAmount' | 'name';
		direction?: 'asc' | 'desc';
		page?: number;
		pageSize?: number;
	}) {
		const rows = (await this.loadEligibleRows()).map(row => deriveRow(row, options.competitor));

		let comparable = rows.filter(r => r.isComparable);
		if (options.brand) comparable = comparable.filter(r => r.brand === options.brand);
		if (options.position) comparable = comparable.filter(r => r.gap!.position === options.position);

		const sort = options.sort ?? 'gapPercent';
		const direction = options.direction ?? 'desc';
		const sign = direction === 'asc' ? 1 : -1;
		comparable.sort((a, b) => {
			if (sort === 'name') return sign * a.name.localeCompare(b.name);
			if (sort === 'gapAmount') return sign * (a.gap!.gapAmount - b.gap!.gapAmount);
			return sign * (a.gap!.gapPercent - b.gap!.gapPercent);
		});

		const page = Math.max(1, options.page ?? 1);
		const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
		const offset = (page - 1) * pageSize;
		const pageItems = comparable.slice(offset, offset + pageSize);

		return {
			items: pageItems.map(row => ({
				productId: row.id,
				brand: row.brand,
				name: row.name,
				category: row.category,
				vizajePrice: row.vizajePriceNum,
				competitorPrice: row.relevantCompetitorPrice,
				competitorSource: row.relevantCompetitorSource,
				gapAmount: row.gap!.gapAmount,
				gapPercent: row.gap!.gapPercent,
				position: row.gap!.position
			})),
			pagination: { page, pageSize, total: comparable.length, totalPages: Math.max(1, Math.ceil(comparable.length / pageSize)) }
		};
	}

	// Discovery-health is a SEPARATE universe from price-monitoring
	// eligibility (discoveryEnabled is its own policy dimension,
	// independent of priceMonitoringEnabled per Milestone 1) - these
	// counts intentionally span every website-confirmed product, not just
	// the price-monitoring-eligible ones, since "why hasn't this been
	// searched" is a discovery question, not a monitoring one.
	async getDiscoveryHealth() {
		const [[websiteConfirmed], [matchedProducts], [pendingAiReview], [retryEligible], [recentErrors], [everChecked]] = await Promise.all([
			this.database.db.select({ total: count() }).from(products).where(isNotNull(products.url)),
			this.database.db.select({ total: countDistinct(matches.productId) }).from(matches).where(inArray(matches.source, CONFIRMED_MATCH_SOURCES)),
			this.database.db.select({ total: count() }).from(discoveryCandidates).where(eq(discoveryCandidates.reviewStatus, 'pending')),
			this.database.db
				.select({ total: count() })
				.from(discoveryAttempts)
				.where(and(inArray(discoveryAttempts.status, ['no_match', 'error']), lte(discoveryAttempts.retryEligibleAt, new Date()))),
			this.database.db.select({ total: count() }).from(discoveryAttempts).where(eq(discoveryAttempts.status, 'error')),
			this.database.db.select({ total: countDistinct(discoveryAttempts.productId) }).from(discoveryAttempts)
		]);

		const websiteConfirmedTotal = Number(websiteConfirmed?.total ?? 0);
		const matchedTotal = Number(matchedProducts?.total ?? 0);
		const everCheckedTotal = Number(everChecked?.total ?? 0);

		// A product counts as "never checked" if it has never produced a
		// discovery_attempts row AND has no confirmed match either - a
		// cheap upper-bound estimate (everCheckedTotal and matchedTotal can
		// overlap, so this can under-count slightly when a product has a
		// match but no attempts row left behind, e.g. after recordMatched's
		// cleanup) rather than a second exact-set query; documented here
		// and in the Milestone 6 report rather than presented as exact.
		const neverCheckedEstimate = Math.max(0, websiteConfirmedTotal - Math.max(everCheckedTotal, matchedTotal));

		return {
			websiteConfirmedProducts: websiteConfirmedTotal,
			unmatched: Math.max(0, websiteConfirmedTotal - matchedTotal),
			pendingAiReview: Number(pendingAiReview?.total ?? 0),
			retryEligible: Number(retryEligible?.total ?? 0),
			recentErrors: Number(recentErrors?.total ?? 0),
			neverCheckedEstimate
		};
	}
}
