import {
  and,
  asc,
  competitorProductVariants,
  competitorProducts,
  competitors,
  count,
  discoveryAttempts,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  jobRuns,
  lte,
  matches,
  not,
  notInArray,
  or,
  products,
  sql,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { canonicalBrand } from '../matching/matching-normalization';
import type { CompetitorDomain } from '../policy/policy-precedence';
import { loadPolicyContext } from '../policy/policy.service';
import { getRotationCursor, setRotationCursor } from './discovery-rotation';

export type DiscoveryTarget = {
  id: number;
  brand: string;
  name: string;
  volume: string | null;
  color: string | null;
};

export type DiscoveryTargetOptions = {
  limit?: number;
  productIds?: number[];

  // Optional filtered-selection flags - see search-query filtering milestone.
  // Leaving ALL of these undefined/false keeps the exact pre-existing
  // id-ascending rotation-cursor behavior (see `usedRotation` below).
  brand?: string;
  inStock?: boolean;
  onlyUnmatched?: boolean;
};

export type DiscoveryFilters = {
  brand: string | null;
  inStock: boolean;
  onlyUnmatched: boolean;
};

export type DiscoveryTargetSelection = {
  targets: DiscoveryTarget[];
  eligibleProducts: number;
  filters: DiscoveryFilters;
  // Whether the legacy id-ascending rotation cursor was used to pick
  // `targets` (true) vs. random selection from a filtered pool (false).
  // Callers only advance/persist the rotation cursor when this is true -
  // the cursor is a queue position for the ROUTINE unfiltered discovery
  // queue specifically, not a general "already tried" marker, so a
  // one-off filtered/random run must not move it.
  usedRotation: boolean;
  // The full SQL-eligible cursor window BEFORE the brand/product discovery
  // policy JS filter is applied - only meaningful when usedRotation is
  // true. Pass THIS (not `targets`) to advanceRotationCursorPastProcessed,
  // together with whatever the caller separately defers for transient
  // reasons (cooldown/search errors). A policy-excluded product is not a
  // transient defer - the rotation cursor must still advance past it (it
  // will become reachable again on the next full wrap-around if an admin
  // re-enables its brand), or a long run of policy-disabled products would
  // otherwise permanently wedge the cursor just before them.
  rotationWindow: DiscoveryTarget[];
};

// Case-insensitive, exact normalized brand comparison - deliberately reuses
// the same deterministic canonicalBrand() normalization (lowercase, strip
// diacritics/punctuation, resolve the confirmed alias table) already shared
// by the matcher, NOT the fuzzy Jaccard name-similarity used for product
// matching. Two brands either normalize to the same canonical string or they
// don't; there is no partial/fuzzy credit here.
export function matchesBrandFilter(productBrand: string, filterBrand: string): boolean {
  return canonicalBrand(productBrand) === canonicalBrand(filterBrand);
}

// Fisher-Yates partial shuffle, O(n). `limit >= pool.length` returns the
// whole pool untouched (order doesn't matter - caller treats it as a set).
export function randomSample<T>(pool: readonly T[], limit: number): T[] {
  if (limit >= pool.length) return [...pool];
  if (limit <= 0) return [];

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, limit);
}

// Excludes a product from the SQL-eligible set while it is pending_review
// (awaiting a future AI/manual review - must never be reselected), while a
// no_match/error outcome's retry backoff hasn't elapsed yet, OR while it is
// 'processing' for a job_run that is still actually alive (status IN
// ('running','stopping')). A 'processing' row whose owning job is NOT alive
// (requeued, cancelled, completed, failed, or lastJobRunId is NULL because
// it predates the worker) is NOT blocked - this is the mechanism that makes
// "a dead job's in-flight SKU becomes selectable again" fall out of the
// ordinary eligibility query, with no separate sweep over discoveryAttempts
// needed (see Milestone 2 DiscoveryWorkerService reconciliation, which only
// ever touches job_runs rows).
function blockedByDiscoveryAttempt(database: DatabaseService, competitorDomain: CompetitorDomain) {
  return exists(
    database.db
      .select({ id: discoveryAttempts.id })
      .from(discoveryAttempts)
      .innerJoin(competitors, eq(discoveryAttempts.competitorId, competitors.id))
      .where(
        and(
          eq(discoveryAttempts.productId, products.id),
          eq(competitors.domain, competitorDomain),
          or(
            eq(discoveryAttempts.status, 'pending_review'),
            and(
              inArray(discoveryAttempts.status, ['no_match', 'error']),
              sql`(${discoveryAttempts.retryEligibleAt} IS NULL OR ${discoveryAttempts.retryEligibleAt} > now())`,
            ),
            and(
              eq(discoveryAttempts.status, 'processing'),
              exists(
                database.db
                  .select({ id: jobRuns.id })
                  .from(jobRuns)
                  .where(
                    and(
                      eq(jobRuns.id, discoveryAttempts.lastJobRunId),
                      inArray(jobRuns.status, ['running', 'stopping']),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
  );
}

// Same "not matched yet on this competitor" subquery used by every
// selection path - pulled out once so selectNextContinuousTarget doesn't
// repeat it a third time.
function alreadyMatchedOnCompetitorSubquery(database: DatabaseService, competitorDomain: CompetitorDomain) {
  return database.db
    .select({ productId: matches.productId })
    .from(matches)
    .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
    .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
    .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
    .where(eq(competitors.domain, competitorDomain));
}

// Bounded window of candidates considered per selectNextContinuousTarget()
// call before applying the brand/policy JS filter - see selectDiscoveryTargets's
// existing comment on why canonicalBrand() can't be a SQL predicate. 200 is
// generous for a ~17k-product / ~100-brand catalog (same scale reasoning
// already used elsewhere in this file).
const CONTINUOUS_SELECTION_WINDOW = 200;

export type ContinuousSelectionOptions = {
  brand?: string;
  inStock?: boolean;
  onlyUnmatched?: boolean;
};

// Milestone 2: the one-SKU-at-a-time selector the DiscoveryWorkerService
// calls before EVERY product (never once per job) - policy/eligibility is
// therefore always evaluated live, never snapshotted into job_runs.params.
// Deterministic ordering: never-checked products first (lowest id first),
// then retry-eligible products oldest-retryEligibleAt-first - this REPLACES
// the legacy random-sample/rotation-cursor behavior for the job-driven path
// only; selectDiscoveryTargets() above (used by the legacy CLI sync()
// methods) is unchanged.
export async function selectNextContinuousTarget(
  database: DatabaseService,
  competitorDomain: CompetitorDomain,
  options: ContinuousSelectionOptions,
): Promise<DiscoveryTarget | null> {
  const policyContext = await loadPolicyContext(database);
  const isEligible = (product: DiscoveryTarget) =>
    (!options.brand || matchesBrandFilter(product.brand, options.brand)) &&
    policyContext.discoveryEnabled(product.brand, product.id, competitorDomain);

  const onlyUnmatched = options.onlyUnmatched ?? true;
  const alreadyMatched = alreadyMatchedOnCompetitorSubquery(database, competitorDomain);

  const baseConditions = [isNotNull(products.url), not(blockedByDiscoveryAttempt(database, competitorDomain))];
  if (onlyUnmatched) baseConditions.push(notInArray(products.id, alreadyMatched));
  if (options.inStock) baseConditions.push(eq(products.available, true));

  const selectColumns = {
    id: products.id,
    brand: products.brand,
    name: products.name,
    volume: products.volume,
    color: products.color,
  };

  // Phase 1: never-checked (no discovery_attempts row at all for this
  // product x competitor) - id-ascending for a stable, reproducible order.
  const neverChecked = await database.db
    .select(selectColumns)
    .from(products)
    .where(
      and(
        ...baseConditions,
        not(
          exists(
            database.db
              .select({ id: discoveryAttempts.id })
              .from(discoveryAttempts)
              .innerJoin(competitors, eq(discoveryAttempts.competitorId, competitors.id))
              .where(
                and(eq(discoveryAttempts.productId, products.id), eq(competitors.domain, competitorDomain)),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(products.id))
    .limit(CONTINUOUS_SELECTION_WINDOW);

  const neverCheckedMatch = neverChecked.find(isEligible);
  if (neverCheckedMatch) return neverCheckedMatch;

  // Phase 2: has a discovery_attempts row, oldest retryEligibleAt first.
  // Reaches a no_match/error row whose backoff has elapsed AND a
  // 'processing' row whose owning job is no longer alive (its
  // retryEligibleAt is NULL, so it sorts after timestamped rows via
  // Postgres's default NULLS LAST on ASC - acceptable: a revived
  // in-flight SKU is not time-critical relative to an overdue retry).
  const retryEligible = await database.db
    .select(selectColumns)
    .from(products)
    .innerJoin(discoveryAttempts, eq(discoveryAttempts.productId, products.id))
    .innerJoin(competitors, eq(discoveryAttempts.competitorId, competitors.id))
    .where(and(...baseConditions, eq(competitors.domain, competitorDomain)))
    .orderBy(asc(discoveryAttempts.retryEligibleAt))
    .limit(CONTINUOUS_SELECTION_WINDOW);

  return retryEligible.find(isEligible) ?? null;
}

// Shared by both MakeupTargetedSyncService and OvicoTargetedSyncService -
// previously near-identical copy-pasted loadTargets() methods, differing
// only in competitor domain / rotation queue key / default limit. Pulling
// this out does not change the selection rule for the unfiltered path (see
// the early-return below, byte-for-byte the same query shape as before) -
// discovery_attempts awareness and brand/product policy are layered ON TOP
// of the pre-existing rules, not a replacement for them. The legacy
// rotation cursor (discovery-rotation.ts) is deliberately kept for this
// milestone - see project notes on why it is not removed yet.
export async function selectDiscoveryTargets(
  database: DatabaseService,
  competitorDomain: CompetitorDomain,
  rotationQueueKey: string,
  defaultLimit: number,
  options: DiscoveryTargetOptions,
): Promise<DiscoveryTargetSelection> {
  const policyContext = await loadPolicyContext(database);
  const isPolicyEligible = (product: DiscoveryTarget) =>
    policyContext.discoveryEnabled(product.brand, product.id, competitorDomain);
  const base = database.db
    .select({
      id: products.id,
      brand: products.brand,
      name: products.name,
      volume: products.volume,
      color: products.color,
    })
    .from(products);

  // Explicit productIds bypass every filter (including rotation) - used for
  // testing, idempotency checks, and deliberate re-discovery, not routine or
  // filtered discovery. Unchanged from before this milestone.
  if (options.productIds && options.productIds.length > 0) {
    const targets = await base.where(
      and(isNotNull(products.url), inArray(products.id, options.productIds)),
    );

    return {
      targets,
      eligibleProducts: targets.length,
      filters: { brand: null, inStock: false, onlyUnmatched: false },
      usedRotation: false,
      rotationWindow: targets,
    };
  }

  const alreadyMatchedOnCompetitor = database.db
    .select({ productId: matches.productId })
    .from(matches)
    .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
    .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
    .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
    .where(eq(competitors.domain, competitorDomain));

  const limit = options.limit ?? defaultLimit;
  const filtersActive = Boolean(options.brand) || options.inStock === true || options.onlyUnmatched !== undefined;

  if (!filtersActive) {
    // Exact pre-existing behavior: website-confirmed (url IS NOT NULL) AND
    // no existing match for THIS competitor, id-ascending rotation cursor,
    // wrapping around when fewer than `limit` remain above it - now also
    // excluding pending_review/not-yet-retry-eligible SKUs (discovery_
    // attempts) at the SQL level. Brand/product discovery policy is a JS
    // post-filter (see isPolicyEligible) for the same reason the existing
    // brand TEXT filter below is JS-only - canonicalBrand()'s alias table
    // isn't a plain SQL predicate. This can make a rotation batch come back
    // smaller than `limit` when policy excludes products within the
    // fetched id-window; accepted for this milestone rather than adding a
    // multi-round top-up query (see project notes).
    const eligible = and(
      isNotNull(products.url),
      notInArray(products.id, alreadyMatchedOnCompetitor),
      not(blockedByDiscoveryAttempt(database, competitorDomain)),
    );

    const [{ value: eligibleProducts }] = await database.db
      .select({ value: count() })
      .from(products)
      .where(eligible);

    const cursor = getRotationCursor(rotationQueueKey);

    const afterCursor = await base
      .where(and(eligible, gt(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit);

    const rawTargets =
      afterCursor.length >= limit
        ? afterCursor
        : [
            ...afterCursor,
            ...(await base
              .where(and(eligible, lte(products.id, cursor)))
              .orderBy(products.id)
              .limit(limit - afterCursor.length)),
          ];

    const targets = rawTargets.filter(isPolicyEligible);

    return {
      targets,
      eligibleProducts,
      filters: { brand: null, inStock: false, onlyUnmatched: true },
      usedRotation: true,
      rotationWindow: rawTargets,
    };
  }

  // Filtered selection: random pick from the full eligible pool (see
  // module notes on `usedRotation` - the rotation cursor is NOT consulted
  // or advanced for this path).
  const onlyUnmatched = options.onlyUnmatched ?? true;

  const conditions = [isNotNull(products.url), not(blockedByDiscoveryAttempt(database, competitorDomain))];
  if (onlyUnmatched) conditions.push(notInArray(products.id, alreadyMatchedOnCompetitor));
  if (options.inStock) conditions.push(eq(products.available, true));

  const pool = await base.where(and(...conditions));

  // Brand TEXT filter (user-requested, e.g. --brand="Clarins") needs
  // canonicalBrand()'s alias table, which isn't expressible as a plain SQL
  // predicate - filtered in JS after the (cheap, already-small) pool is
  // loaded, same as before this milestone. Brand/product discovery POLICY
  // (independent of the user's optional brand filter) is applied the same
  // way right after.
  const brandFilteredPool = options.brand
    ? pool.filter(product => matchesBrandFilter(product.brand, options.brand!))
    : pool;
  const filteredPool = brandFilteredPool.filter(isPolicyEligible);

  const targets = randomSample(filteredPool, limit);

  return {
    targets,
    eligibleProducts: filteredPool.length,
    filters: {
      brand: options.brand ?? null,
      inStock: Boolean(options.inStock),
      onlyUnmatched,
    },
    usedRotation: false,
    rotationWindow: targets,
  };
}

// Only called for the unfiltered rotation path (usedRotation === true) -
// callers should gate this the same way the pre-existing code already did.
export function advanceRotationCursorPastProcessed(
  rotationQueueKey: string,
  allTargets: DiscoveryTarget[],
  deferredProductIds: number[],
): void {
  const deferredSet = new Set(deferredProductIds);
  const actuallyProcessed = allTargets.filter(t => !deferredSet.has(t.id));

  if (actuallyProcessed.length > 0) {
    const maxProcessedId = Math.max(...actuallyProcessed.map(t => t.id));
    setRotationCursor(rotationQueueKey, maxProcessedId);
  }
}
