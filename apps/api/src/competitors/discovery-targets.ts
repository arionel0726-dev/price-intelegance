import {
  and,
  competitorProductVariants,
  competitorProducts,
  competitors,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  lte,
  matches,
  notInArray,
  products,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { canonicalBrand } from '../matching/matching-normalization';
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

// Shared by both MakeupTargetedSyncService and OvicoTargetedSyncService -
// previously near-identical copy-pasted loadTargets() methods, differing
// only in competitor domain / rotation queue key / default limit. Pulling
// this out does not change the selection rule for the unfiltered path (see
// the early-return below, byte-for-byte the same query shape as before).
export async function selectDiscoveryTargets(
  database: DatabaseService,
  competitorDomain: string,
  rotationQueueKey: string,
  defaultLimit: number,
  options: DiscoveryTargetOptions,
): Promise<DiscoveryTargetSelection> {
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
    // wrapping around when fewer than `limit` remain above it.
    const eligible = and(isNotNull(products.url), notInArray(products.id, alreadyMatchedOnCompetitor));

    const [{ value: eligibleProducts }] = await database.db
      .select({ value: count() })
      .from(products)
      .where(eligible);

    const cursor = getRotationCursor(rotationQueueKey);

    const afterCursor = await base
      .where(and(eligible, gt(products.id, cursor)))
      .orderBy(products.id)
      .limit(limit);

    const targets =
      afterCursor.length >= limit
        ? afterCursor
        : [
            ...afterCursor,
            ...(await base
              .where(and(eligible, lte(products.id, cursor)))
              .orderBy(products.id)
              .limit(limit - afterCursor.length)),
          ];

    return {
      targets,
      eligibleProducts,
      filters: { brand: null, inStock: false, onlyUnmatched: true },
      usedRotation: true,
    };
  }

  // Filtered selection: random pick from the full eligible pool (see
  // module notes on `usedRotation` - the rotation cursor is NOT consulted
  // or advanced for this path).
  const onlyUnmatched = options.onlyUnmatched ?? true;

  const conditions = [isNotNull(products.url)];
  if (onlyUnmatched) conditions.push(notInArray(products.id, alreadyMatchedOnCompetitor));
  if (options.inStock) conditions.push(eq(products.available, true));

  const pool = await base.where(and(...conditions));

  // Brand comparison needs canonicalBrand()'s alias table, which isn't
  // expressible as a plain SQL predicate - filtered in JS after the (cheap,
  // already-small) pool is loaded. 17k total products / ~100 distinct
  // brands at the time of writing, so this is a non-issue performance-wise.
  const filteredPool = options.brand
    ? pool.filter(product => matchesBrandFilter(product.brand, options.brand!))
    : pool;

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
