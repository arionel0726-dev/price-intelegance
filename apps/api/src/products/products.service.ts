import { Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  competitorProductVariants,
  competitorProducts,
  competitors,
  count,
  countDistinct,
  desc,
  discoveryAttempts,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  knownPlaceholderImages,
  matches,
  not,
  notInArray,
  or,
  productBarcodes,
  productPolicyOverrides,
  products,
  sql,
  type SQL,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { canonicalBrand } from '../matching/matching-normalization';
import {
  effectiveDiscoveryEnabled,
  effectivePriceMonitoringEnabled,
  effectiveVisibleInCatalog,
  type CompetitorDomain,
} from '../policy/policy-precedence';
import { PolicyService } from '../policy/policy.service';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_LABELS,
  isCategoryGroupKey,
} from './category-groups';
import { classifyImageStatus, loadPlaceholderUrlSet, type ImageStatus } from './image-status';

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

export type ProductsListQuery = {
  page?: number;
  limit?: number;
  // Admin/Data Quality escape hatch - false (default) hides missing/
  // placeholder-image products and policy-hidden brands/products from the
  // ordinary catalog listing; true lifts both so a future Data Quality
  // screen can see everything. Never changes discovery/price-monitoring
  // eligibility - those never consult this flag or the image/visibility
  // state at all.
  includeHidden?: boolean;
  search?: string;
  brand?: string;
  category?: string;
};

export type VariantType = 'volume' | 'shade' | 'variant';

// Avoids duplicated output like "<parent title> <label>" when the parser's
// variant label is already the full product name (e.g. shade variants that
// repeat brand + product name instead of just the shade).
function composeCompetitorTitle(
  parentTitle: string,
  label: string | null,
  volume: string | null,
) {
  if (volume) {
    return `${parentTitle} ${volume}`.trim();
  }

  if (label) {
    const normalizedLabel = label.trim();
    const looksLikeFullName = normalizedLabel
      .toLowerCase()
      .startsWith(parentTitle.toLowerCase());

    if (looksLikeFullName || normalizedLabel.length > 40) {
      return normalizedLabel;
    }

    return `${parentTitle} ${normalizedLabel}`.trim();
  }

  return parentTitle;
}

// "Primarily differs by volume" / "primarily differs by color" - a family
// where only one of the two dimensions varies across its website-confirmed
// SKUs gets a specific label; anything else (both vary, or neither) falls
// back to the generic "variant" label rather than guessing.
function inferVariantType(volumeVariety: number, colorVariety: number): VariantType {
  const volumeVaries = volumeVariety > 1;
  const colorVaries = colorVariety > 1;

  if (volumeVaries && !colorVaries) return 'volume';
  if (colorVaries && !volumeVaries) return 'shade';
  return 'variant';
}

function buildVariantLabel(variantCount: number, variantType: VariantType): string | null {
  if (variantCount <= 1) return null;

  switch (variantType) {
    case 'volume':
      return `${variantCount} volumes`;
    case 'shade':
      return `${variantCount} shades`;
    default:
      return `${variantCount} variants`;
  }
}

function parseLeadingNumber(value: string | null): number | null {
  if (!value) return null;

  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// Grouping key for the "variant family" a SKU belongs to: Vizaje's raw
// VariativeNomenclature id, or the product's own id when that's absent
// (fallback per spec - a product with no variant_group_id is its own
// family of one). Defined as a function, not a shared constant, so each
// query gets its own SQL chunk instead of reusing internal builder state
// across unrelated queries.
function groupKeyExpr() {
  return sql<string>`coalesce(${products.variantGroupId}, 'p:' || ${products.id}::text)`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly policy: PolicyService,
  ) {}

  // Catalog list, grouped into "variant families" (see groupKeyExpr) so
  // sibling Vizaje SKUs (volume/shade ladders sharing one
  // products.variant_group_id) render as a single card. The grouping - and
  // the search/brand/category filtering that decides which families match -
  // happens entirely in SQL: never only on the current page's 40 rows, since
  // siblings can land on different DB pages.
  async findAll(query: ProductsListQuery) {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * limit;

    const hasSearch = Boolean(query.search?.trim());
    // Brand visibility needs canonicalBrand()'s alias table, which isn't a
    // plain SQL predicate (same limitation as the brand TEXT filter below
    // and the discovery brand-policy gate in discovery-targets.ts) - so the
    // set of raw brand spellings a hidden canonical brand maps to is
    // resolved once per request, then pushed into buildWhere as a plain
    // SQL `NOT IN`. ~100 distinct brands total, so this is one small extra
    // query, not a per-row cost.
    const hiddenRawBrands = query.includeHidden ? [] : await this.resolveHiddenRawBrands();
    const skuWhere = this.buildWhere(query, hiddenRawBrands);

    const [totals, groupPage] = await Promise.all([
      this.database.db
        .select({
          skuTotal: count(),
          familyTotal: countDistinct(groupKeyExpr()),
        })
        .from(products)
        .where(skuWhere)
        .then(rows => rows[0]!),
      this.database.db
        .select({
          groupKey: groupKeyExpr(),
          minId: sql<number>`min(${products.id})`,
        })
        .from(products)
        .where(skuWhere)
        .groupBy(groupKeyExpr())
        // Stable default order: brand, then name, then id as a final
        // tiebreaker - same ordering the SKU-level list used before family
        // grouping, just computed per-group.
        .orderBy(
          sql`min(${products.brand})`,
          sql`min(${products.name})`,
          sql`min(${products.id})`,
        )
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(totals.familyTotal);
    const skuTotal = Number(totals.skuTotal);

    if (groupPage.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          skuTotal,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    }

    const groupKeys = groupPage.map(row => row.groupKey);

    const [representatives, aggregates, minPriceCompetitor] = await Promise.all([
      hasSearch
        ? // A search term matched specific SKUs within these families - use
          // the lowest matching id as the representative/link target (§15),
          // rather than the generic "first image" rule below. groupKey is a
          // plain per-row expression here (no GROUP BY needed) - included so
          // both branches share one shape for the merge below.
          this.database.db
            .select({
              groupKey: groupKeyExpr(),
              id: products.id,
              brand: products.brand,
              name: products.name,
              imageUrl: products.imageUrl,
              category: products.category,
              volume: products.volume,
              color: products.color,
              createdAt: products.createdAt,
              updatedAt: products.updatedAt,
            })
            .from(products)
            .where(
              inArray(
                products.id,
                groupPage.map(row => Number(row.minId)),
              ),
            )
        : // No search - pick a stable representative per family: the first
          // variant with an image, tie-broken by lowest id; falls back to
          // lowest id when no sibling has an image.
          this.database.db
            .selectDistinctOn([groupKeyExpr()], {
              groupKey: groupKeyExpr(),
              id: products.id,
              brand: products.brand,
              name: products.name,
              imageUrl: products.imageUrl,
              category: products.category,
              volume: products.volume,
              color: products.color,
              createdAt: products.createdAt,
              updatedAt: products.updatedAt,
            })
            .from(products)
            .where(and(isNotNull(products.url), inArray(groupKeyExpr(), groupKeys)))
            .orderBy(
              groupKeyExpr(),
              sql`(${products.imageUrl} is null) asc`,
              asc(products.id),
            ),
      // Family totals (variant count, min/max price, volume/color variety)
      // are computed over ALL website-confirmed siblings of each matched
      // family, not just the SKUs that happened to match a search term -
      // "4 volumes" and "from X MDL" should reflect the whole family.
      this.database.db
        .select({
          groupKey: groupKeyExpr(),
          variantCount: count(),
          minPrice: sql<string | null>`min(${products.price})`,
          maxPrice: sql<string | null>`max(${products.price})`,
          volumeVariety: sql`count(distinct nullif(${products.volume}, ''))`.mapWith(Number),
          colorVariety: sql`count(distinct nullif(${products.color}, ''))`.mapWith(Number),
        })
        .from(products)
        .where(and(isNotNull(products.url), inArray(groupKeyExpr(), groupKeys)))
        .groupBy(groupKeyExpr()),
      // Competitor price for the catalog card MUST come from the exact same
      // SKU that `aggregate.minPrice` displays as `product.price` - never
      // from a cheaper/pricier sibling's own match. (Real example that would
      // otherwise mismatch: variant_group_id 304 - 30ml/1100 has no match,
      // 50ml/1650 matches MAKEUP at 1535; comparing family minima would have
      // shown 1100 vs 1535 as "favorable", when the 30ml SKU actually shown
      // has no valid comparison at all.) DISTINCT ON picks the row that
      // achieves MIN(price) per family (ties broken by lowest id, same
      // convention as the representative-picking query above), then a
      // correlated subquery scoped to `products.id = <that one row>` finds
      // only that SKU's own cheapest confirmed match - never a sibling's.
      // Bounded to this page's groupKeys, same as every other query here.
      this.database.db
        .selectDistinctOn([groupKeyExpr()], {
          groupKey: groupKeyExpr(),
          // Qualified as "products"."id" (not a bare interpolated column
          // ref) - unqualified "id" here is ambiguous with matches.id once
          // nested inside this correlated subquery's own FROM/JOIN scope.
          competitorPrice: sql<string | null>`(
            select min(cpv.price)
            from matches m
            inner join competitor_product_variants cpv on cpv.id = m.competitor_product_variant_id
            where m.product_id = "products"."id"
          )`,
        })
        .from(products)
        .where(and(isNotNull(products.url), inArray(groupKeyExpr(), groupKeys)))
        .orderBy(groupKeyExpr(), asc(products.price), asc(products.id)),
    ]);

    const representativeByGroupKey = new Map(representatives.map(row => [row.groupKey, row]));
    const aggregateByGroupKey = new Map(aggregates.map(row => [row.groupKey, row]));
    const competitorPriceByGroupKey = new Map(
      minPriceCompetitor.map(row => [row.groupKey, row.competitorPrice]),
    );

    const items = groupPage
      .map(row => {
        const representative = representativeByGroupKey.get(row.groupKey);
        const aggregate = aggregateByGroupKey.get(row.groupKey);

        if (!representative || !aggregate) return null;

        const variantCount = Number(aggregate.variantCount);
        const variantType = inferVariantType(
          Number(aggregate.volumeVariety),
          Number(aggregate.colorVariety),
        );
        const priceVaries = aggregate.minPrice !== aggregate.maxPrice;

        return {
          id: representative.id,
          brand: representative.brand,
          name: representative.name,
          category: representative.category,
          imageUrl: representative.imageUrl,
          // Only shown when the family is a single SKU - a multi-variant
          // card shouldn't imply one specific volume/color.
          volume: variantCount > 1 ? null : representative.volume,
          color: variantCount > 1 ? null : representative.color,
          price: aggregate.minPrice,
          priceVaries,
          // Cheapest confirmed match belonging to the SAME SKU as `price`
          // above (never a sibling's) - null if that specific SKU has no
          // match yet. Drives the card's price color, never used for
          // grouping/identity.
          competitorPrice: competitorPriceByGroupKey.get(row.groupKey) ?? null,
          variantCount,
          variantLabel: buildVariantLabel(variantCount, variantType),
          createdAt: representative.createdAt,
          updatedAt: representative.updatedAt,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        skuTotal,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getFilters() {
    const websiteConfirmed = isNotNull(products.url);

    const brandRows = await this.database.db
      .selectDistinct({ brand: products.brand })
      .from(products)
      .where(websiteConfirmed)
      .orderBy(asc(products.brand));

    return {
      brands: brandRows.map(row => row.brand),
      // Curated business-level groups (see category-groups.ts), not the
      // ~104 raw Vizaje categories - the frontend never sees raw category
      // strings.
      categories: (Object.keys(CATEGORY_GROUPS) as (keyof typeof CATEGORY_GROUPS)[]).map(
        key => ({ key, label: CATEGORY_GROUP_LABELS[key] }),
      ),
    };
  }

  async findOne(id: number) {
    const [product] = await this.database.db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const [competitorRows, siblingRows] = await Promise.all([
      this.database.db
        .select({
          id: competitorProductVariants.id,
          competitorName: competitors.name,
          title: competitorProducts.title,
          label: competitorProductVariants.label,
          volume: competitorProductVariants.volume,
          imageUrl: competitorProducts.imageUrl,
          price: competitorProductVariants.price,
          url: competitorProducts.url,
        })
        .from(matches)
        .innerJoin(
          competitorProductVariants,
          eq(matches.competitorProductVariantId, competitorProductVariants.id),
        )
        .innerJoin(
          competitorProducts,
          eq(competitorProductVariants.competitorProductId, competitorProducts.id),
        )
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id),
        )
        // SKU-specific: competitor matches belong to this exact product row,
        // never aggregated across sibling variants (§10).
        .where(eq(matches.productId, id)),
      product.variantGroupId
        ? this.database.db
            .select({
              id: products.id,
              volume: products.volume,
              color: products.color,
              price: products.price,
            })
            .from(products)
            .where(
              and(eq(products.variantGroupId, product.variantGroupId), isNotNull(products.url)),
            )
        : Promise.resolve([]),
    ]);

    const volumeVariety = new Set(
      siblingRows.map(row => row.volume).filter((value): value is string => Boolean(value)),
    ).size;
    const colorVariety = new Set(
      siblingRows.map(row => row.color).filter((value): value is string => Boolean(value)),
    ).size;
    const variantType = inferVariantType(volumeVariety, colorVariety);

    const orderedSiblings = [...siblingRows].sort((a, b) => {
      const key = variantType === 'shade' ? 'color' : 'volume';
      const aNumber = parseLeadingNumber(a[key]);
      const bNumber = parseLeadingNumber(b[key]);

      if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
        return aNumber - bNumber;
      }

      const aValue = a[key] ?? '';
      const bValue = b[key] ?? '';
      if (aValue !== bValue) return aValue.localeCompare(bValue);

      return a.id - b.id;
    });

    return {
      product,
      variantType,
      // Only meaningful with more than one SKU in the family - a lone
      // product (or one whose siblings aren't website-confirmed) shouldn't
      // render a selector with a single button.
      siblings: orderedSiblings.length > 1 ? orderedSiblings : [],
      competitors: competitorRows.map(({ label, volume, ...row }) => ({
        ...row,
        title: composeCompetitorTitle(row.title, label, volume),
      })),
    };
  }

  // Website-confirmed by default (products.url IS NOT NULL) - the ~5.3k
  // legacy-only rows stay out of the normal catalog without being deleted.
  // Search spans name/brand/products.barcode/sourceId plus an EXISTS
  // subquery against product_barcodes for alternate barcodes, instead of a
  // JOIN, specifically to avoid row multiplication when a product has more
  // than one barcode. Operates at SKU level - findAll() groups the matching
  // rows into families afterward, so a search hit on any one sibling still
  // surfaces its whole family (§15).
  // Raw products.brand spellings whose canonical brand is catalog-hidden -
  // see the comment in findAll(). Small (~100 distinct brands) and run
  // once per catalog request, same cost class as the existing getFilters()
  // distinct-brand query.
  private async resolveHiddenRawBrands(): Promise<string[]> {
    const hiddenKeys = await this.policy.loadHiddenCanonicalBrandKeys();
    if (hiddenKeys.size === 0) return [];

    const distinctBrands = await this.database.db.selectDistinct({ brand: products.brand }).from(products);
    return distinctBrands.map(row => row.brand).filter(brand => hiddenKeys.has(canonicalBrand(brand)));
  }

  private buildWhere(query: ProductsListQuery, hiddenRawBrands: string[]): SQL | undefined {
    const conditions: SQL[] = [isNotNull(products.url)];

    if (!query.includeHidden) {
      // Image status: hide missing (NULL) and confirmed-placeholder images
      // by default - a non-null imageUrl alone is NOT sufficient (see
      // known_placeholder_images / project notes). Never excludes a product
      // from discovery/price monitoring - those tables are never consulted
      // outside this catalog-listing query.
      //
      // isNotNull is REQUIRED as its own condition, not implied by the
      // notInArray below: SQL's `x NOT IN (subquery)` is vacuously TRUE for
      // x = NULL whenever the subquery itself returns zero rows (an empty
      // `IN` list is unconditionally false, so its negation is true) - so
      // on a fresh deployment, before any placeholder URL is ever
      // confirmed into known_placeholder_images, a missing-image product
      // would otherwise NOT be hidden at all until the first placeholder is
      // registered. Asserting isNotNull directly avoids depending on that
      // three-valued-logic edge case.
      conditions.push(isNotNull(products.imageUrl));
      conditions.push(
        notInArray(
          products.imageUrl,
          this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages),
        ),
      );

      // Catalog visibility: product override (tri-state) > brand policy >
      // default true. Expressed as "not explicitly force-hidden by a
      // product override" AND ("explicitly force-shown by a product
      // override" OR "the brand doesn't hide it") - see
      // policy-precedence.ts for the same precedence computed in JS for
      // discovery/refresh, where a SQL predicate isn't needed because
      // those operate over an already-loaded set rather than a paginated
      // query.
      conditions.push(
        not(
          exists(
            this.database.db
              .select({ id: productPolicyOverrides.productId })
              .from(productPolicyOverrides)
              .where(
                and(
                  eq(productPolicyOverrides.productId, products.id),
                  eq(productPolicyOverrides.catalogEnabledOverride, false),
                ),
              ),
          ),
        ),
      );
      conditions.push(
        or(
          exists(
            this.database.db
              .select({ id: productPolicyOverrides.productId })
              .from(productPolicyOverrides)
              .where(
                and(
                  eq(productPolicyOverrides.productId, products.id),
                  eq(productPolicyOverrides.catalogEnabledOverride, true),
                ),
              ),
          ),
          hiddenRawBrands.length > 0 ? notInArray(products.brand, hiddenRawBrands) : sql`true`,
        )!,
      );
    }

    if (query.brand) {
      conditions.push(eq(products.brand, query.brand));
    }

    // The frontend sends a stable UI group key (perfume/makeup/skincare/
    // hair/men), never a raw Vizaje category string - see category-groups.ts.
    // An unrecognized key is ignored rather than rejected, so a stale/bad
    // value degrades to "no category filter" instead of a hard error.
    if (query.category && isCategoryGroupKey(query.category)) {
      const rawCategories = CATEGORY_GROUPS[query.category];
      // TRIM: one real source category ("Уход за бородой") carries a
      // trailing space, and matching the raw column directly would silently
      // exclude it - see category-groups.ts.
      conditions.push(inArray(sql`trim(${products.category})`, rawCategories));
    }

    const searchCondition = this.searchCondition(query.search);
    if (searchCondition) conditions.push(searchCondition);

    return and(...conditions);
  }

  // Extracted verbatim from buildWhere's inline search block so Admin's
  // product list (findAllAdmin below) matches the exact same name/brand/
  // barcode/sourceId search the ordinary catalog uses, instead of a second,
  // possibly-drifting implementation.
  private searchCondition(search: string | undefined): SQL | undefined {
    const trimmed = search?.trim();
    if (!trimmed) return undefined;

    const term = `%${trimmed}%`;

    return or(
      ilike(products.name, term),
      ilike(products.brand, term),
      ilike(products.barcode, term),
      ilike(products.sourceId, term),
      exists(
        this.database.db
          .select({ id: productBarcodes.id })
          .from(productBarcodes)
          .where(
            and(
              eq(productBarcodes.productId, products.id),
              ilike(productBarcodes.barcode, term),
            ),
          ),
      ),
    );
  }

  // --- Milestone 5: Admin Control Center -----------------------------

  // Admin's product list is deliberately SKU-level (never grouped into
  // variant families like findAll() above) - each row can carry its own
  // policy override, and an admin managing overrides needs to see and act
  // on exactly the SKU they're overriding, not a family representative.
  // Also deliberately does NOT require products.url IS NOT NULL - Data
  // Quality explicitly wants to surface legacy/never-website-confirmed
  // rows too (see getDataQualitySummary below).
  async findAllAdmin(query: AdminProductsListQuery) {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    const searchCondition = this.searchCondition(query.search);
    if (searchCondition) conditions.push(searchCondition);

    if (query.brand) conditions.push(eq(products.brand, query.brand));

    if (query.category && isCategoryGroupKey(query.category)) {
      const rawCategories = CATEGORY_GROUPS[query.category];
      conditions.push(inArray(sql`trim(${products.category})`, rawCategories));
    }

    if (query.imageState && query.imageState !== 'all') {
      if (query.imageState === 'missing') {
        conditions.push(isNull(products.imageUrl));
      } else if (query.imageState === 'placeholder') {
        conditions.push(
          and(
            isNotNull(products.imageUrl),
            exists(
              this.database.db
                .select({ imageUrl: knownPlaceholderImages.imageUrl })
                .from(knownPlaceholderImages)
                .where(eq(knownPlaceholderImages.imageUrl, products.imageUrl)),
            ),
          )!,
        );
      } else {
        // 'real': present AND not a confirmed placeholder.
        conditions.push(
          and(
            isNotNull(products.imageUrl),
            notInArray(
              products.imageUrl,
              this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages),
            ),
          )!,
        );
      }
    }

    const overrideExists = exists(
      this.database.db.select({ id: productPolicyOverrides.productId }).from(productPolicyOverrides).where(eq(productPolicyOverrides.productId, products.id)),
    );
    if (query.overrideState === 'has_override') conditions.push(overrideExists);
    if (query.overrideState === 'inherit') conditions.push(not(overrideExists));

    if (query.exclusionReason && query.exclusionReason !== 'all') {
      conditions.push(
        exists(
          this.database.db
            .select({ id: productPolicyOverrides.productId })
            .from(productPolicyOverrides)
            .where(
              and(
                eq(productPolicyOverrides.productId, products.id),
                eq(productPolicyOverrides.exclusionReason, query.exclusionReason),
              ),
            ),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }], policyContext, placeholderUrls] = await Promise.all([
      this.database.db
        .select({
          id: products.id,
          brand: products.brand,
          name: products.name,
          category: products.category,
          imageUrl: products.imageUrl,
          url: products.url,
          hasOverride: overrideExists,
          exclusionReason: sql<string | null>`(
            select ${productPolicyOverrides.exclusionReason}
            from ${productPolicyOverrides}
            where ${productPolicyOverrides.productId} = ${products.id}
          )`,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .where(where)
        .orderBy(desc(products.updatedAt), asc(products.id))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(products).where(where),
      this.policy.loadContext(),
      loadPlaceholderUrlSet(this.database),
    ]);

    const items = rows.map(row => {
      const { brand: brandRow, override } = policyContext.resolveRaw(row.brand, row.id);
      return {
        ...row,
        imageStatus: classifyImageStatus(row.imageUrl, placeholderUrls),
        effective: {
          visibleInCatalog: effectiveVisibleInCatalog(brandRow, override),
          makeupDiscoveryEnabled: effectiveDiscoveryEnabled(brandRow, override, 'makeup.md'),
          ovicoDiscoveryEnabled: effectiveDiscoveryEnabled(brandRow, override, 'ovico.md'),
          priceMonitoringEnabled: effectivePriceMonitoringEnabled(brandRow, override),
        },
      };
    });

    return {
      items,
      pagination: { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) },
    };
  }

  // GET /admin/products/:id's effective-policy diagnostic. Every effective
  // value is computed via the shared policy-precedence.ts functions - this
  // never recomputes the precedence rule itself, only assembles the
  // brand/override/effective triple per dimension plus the discovery-
  // eligibility (matches row? discovery_attempts status? retryEligibleAt?)
  // and price-monitoring notes the brief asks for. Deliberately never
  // includes ruleScore/ruleSignals/AI thresholds - that is M3's AI Review
  // surface, not Admin's.
  async getAdminProductDetail(id: number) {
    const [product] = await this.database.db.select().from(products).where(eq(products.id, id));
    if (!product) throw new NotFoundException('Product not found');

    const [[override], policyContext, matchRows, attemptRows] = await Promise.all([
      this.database.db.select().from(productPolicyOverrides).where(eq(productPolicyOverrides.productId, id)),
      this.policy.loadContext(),
      this.database.db
        .select({ competitorDomain: competitors.domain })
        .from(matches)
        .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
        .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
        .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
        .where(eq(matches.productId, id)),
      this.database.db
        .select({
          competitorDomain: competitors.domain,
          status: discoveryAttempts.status,
          retryEligibleAt: discoveryAttempts.retryEligibleAt,
          lastCheckedAt: discoveryAttempts.lastCheckedAt,
        })
        .from(discoveryAttempts)
        .innerJoin(competitors, eq(discoveryAttempts.competitorId, competitors.id))
        .where(eq(discoveryAttempts.productId, id)),
    ]);

    const { brand: brandRow } = policyContext.resolveRaw(product.brand, id);
    const overrideRow = override ?? undefined;

    const matchedDomains = new Set(matchRows.map(r => r.competitorDomain));
    const attemptByDomain = new Map(attemptRows.map(r => [r.competitorDomain, r]));

    function discoveryDiagnostic(domain: CompetitorDomain) {
      const attempt = attemptByDomain.get(domain);
      return {
        effective: effectiveDiscoveryEnabled(brandRow, overrideRow, domain),
        hasMatch: matchedDomains.has(domain),
        discoveryAttemptStatus: attempt?.status ?? null,
        retryEligibleAt: attempt?.retryEligibleAt ?? null,
        lastCheckedAt: attempt?.lastCheckedAt ?? null,
      };
    }

    return {
      product,
      override: overrideRow ?? null,
      brandPolicy: brandRow ?? null,
      effectivePolicy: {
        catalog: {
          brandValue: brandRow?.visibleInCatalog ?? null,
          override: overrideRow?.catalogEnabledOverride ?? null,
          effective: effectiveVisibleInCatalog(brandRow, overrideRow),
        },
        priceMonitoring: {
          brandValue: brandRow?.priceMonitoringEnabled ?? null,
          override: overrideRow?.priceMonitoringEnabledOverride ?? null,
          effective: effectivePriceMonitoringEnabled(brandRow, overrideRow),
          // Disabling monitoring never deletes existing match data - UI
          // copy only, the backend never touches `matches` here.
          note: 'Disabling price monitoring stops future price refreshes. It never deletes existing match data.',
        },
        discovery: {
          makeup: { brandValue: brandRow?.makeupDiscoveryEnabled ?? null, override: overrideRow?.discoveryEnabledOverride ?? null, ...discoveryDiagnostic('makeup.md') },
          ovico: { brandValue: brandRow?.ovicoDiscoveryEnabled ?? null, override: overrideRow?.discoveryEnabledOverride ?? null, ...discoveryDiagnostic('ovico.md') },
        },
      },
    };
  }

  // Tri-state override write, with the sparse-row hygiene the brief
  // requires: if the patch results in every override column NULL AND no
  // reason/note, the row is deleted outright rather than kept as an
  // all-NULL row (product_policy_overrides is documented as sparse - "a
  // row exists only where a product-level override was explicitly set").
  async updateProductPolicy(
    id: number,
    patch: {
      catalogEnabledOverride?: boolean | null;
      discoveryEnabledOverride?: boolean | null;
      priceMonitoringEnabledOverride?: boolean | null;
      exclusionReason?: string | null;
      reasonNote?: string | null;
    },
    updatedBy: string | null,
  ) {
    const [product] = await this.database.db.select({ id: products.id }).from(products).where(eq(products.id, id));
    if (!product) throw new NotFoundException('Product not found');

    const [existing] = await this.database.db.select().from(productPolicyOverrides).where(eq(productPolicyOverrides.productId, id));

    const next = {
      catalogEnabledOverride: patch.catalogEnabledOverride !== undefined ? patch.catalogEnabledOverride : existing?.catalogEnabledOverride ?? null,
      discoveryEnabledOverride: patch.discoveryEnabledOverride !== undefined ? patch.discoveryEnabledOverride : existing?.discoveryEnabledOverride ?? null,
      priceMonitoringEnabledOverride:
        patch.priceMonitoringEnabledOverride !== undefined ? patch.priceMonitoringEnabledOverride : existing?.priceMonitoringEnabledOverride ?? null,
      exclusionReason: patch.exclusionReason !== undefined ? patch.exclusionReason : existing?.exclusionReason ?? null,
      reasonNote: patch.reasonNote !== undefined ? patch.reasonNote : existing?.reasonNote ?? null,
    };

    const isFullyEmpty =
      next.catalogEnabledOverride === null &&
      next.discoveryEnabledOverride === null &&
      next.priceMonitoringEnabledOverride === null &&
      next.exclusionReason === null &&
      next.reasonNote === null;

    if (isFullyEmpty) {
      if (existing) {
        await this.database.db.delete(productPolicyOverrides).where(eq(productPolicyOverrides.productId, id));
      }
      return null;
    }

    const [row] = await this.database.db
      .insert(productPolicyOverrides)
      .values({ productId: id, ...next, updatedBy })
      .onConflictDoUpdate({ target: productPolicyOverrides.productId, set: { ...next, updatedBy, updatedAt: new Date() } })
      .returning();

    return row;
  }

  // Milestone 1's image classification rule, reused verbatim (via
  // image-status.ts) rather than a frequency heuristic. products.brand is
  // NOT NULL in the schema, so "empty/unknown brand" is genuinely
  // impossible at the DB level - this summary reports 0 for that category
  // rather than inventing a heuristic for a case that cannot occur (see
  // Milestone 5 report point 15).
  async getDataQualitySummary() {
    // Deliberately 3 separate WHERE-filtered counts rather than one
    // GROUP BY over imageStatusExpr(): using the same CASE expression in
    // both a SELECT list and a GROUP BY clause in one query hit a drizzle-
    // orm 0.45.2 quirk where the two renderings of the expression
    // diverged (the SELECT copy lost products' table qualification on
    // image_url, turning the placeholder EXISTS subquery into a
    // self-referential always-true check) - caught by this script's own
    // "placeholder count unaffected" assertion failing while the delta
    // assertions for missing/real still happened to pass, which is exactly
    // why this is 3 independent, individually-correct queries instead.
    const missingCondition = isNull(products.imageUrl);
    const placeholderCondition = and(
      isNotNull(products.imageUrl),
      exists(this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages).where(eq(knownPlaceholderImages.imageUrl, products.imageUrl))),
    )!;
    const realCondition = and(
      isNotNull(products.imageUrl),
      notInArray(products.imageUrl, this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages)),
    )!;

    const [missingCount, placeholderCount, realCount, noUrlCount, exclusionCounts, emptyBrandCount] = await Promise.all([
      this.database.db.select({ total: count() }).from(products).where(missingCondition),
      this.database.db.select({ total: count() }).from(products).where(placeholderCondition),
      this.database.db.select({ total: count() }).from(products).where(realCondition),
      this.database.db.select({ total: count() }).from(products).where(isNull(products.url)),
      this.database.db
        .select({ reason: productPolicyOverrides.exclusionReason, total: count() })
        .from(productPolicyOverrides)
        .where(isNotNull(productPolicyOverrides.exclusionReason))
        .groupBy(productPolicyOverrides.exclusionReason),
      // Impossible given brand NOT NULL - included for completeness/
      // transparency rather than silently omitted, see report point 15.
      this.database.db.select({ total: count() }).from(products).where(eq(products.brand, '')),
    ]);

    const byImageStatus: Record<ImageStatus, number> = {
      missing: Number(missingCount[0]?.total ?? 0),
      placeholder: Number(placeholderCount[0]?.total ?? 0),
      real: Number(realCount[0]?.total ?? 0),
    };

    return {
      images: byImageStatus,
      productsWithNoUrl: Number(noUrlCount[0]?.total ?? 0),
      productsWithEmptyBrand: Number(emptyBrandCount[0]?.total ?? 0),
      productsByExclusionReason: exclusionCounts.map(row => ({ reason: row.reason, total: Number(row.total) })),
    };
  }

  // Backs the Data Quality image list view - same imageState filter values
  // as findAllAdmin's, factored out as its own lightweight query rather
  // than forcing the full admin product-list shape (override/effective
  // policy) onto a view that's purely about image status.
  async listImagesForAdmin(query: { page?: number; limit?: number; imageState?: ImageStatus | 'all' }) {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.limit ?? DEFAULT_PAGE_SIZE)));
    const offset = (page - 1) * limit;

    // Same WHERE-level conditions as findAllAdmin's imageState branches
    // (plain drizzle helpers - eq/isNull/notInArray - never a raw
    // correlated-subquery `sql` expression; see image-status.ts for why).
    let where: SQL | undefined;
    if (query.imageState === 'missing') {
      where = isNull(products.imageUrl);
    } else if (query.imageState === 'placeholder') {
      where = and(
        isNotNull(products.imageUrl),
        exists(this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages).where(eq(knownPlaceholderImages.imageUrl, products.imageUrl))),
      );
    } else if (query.imageState === 'real') {
      where = and(
        isNotNull(products.imageUrl),
        notInArray(products.imageUrl, this.database.db.select({ imageUrl: knownPlaceholderImages.imageUrl }).from(knownPlaceholderImages)),
      );
    }

    const [rows, [{ total }], placeholderUrls] = await Promise.all([
      this.database.db
        .select({ id: products.id, brand: products.brand, name: products.name, imageUrl: products.imageUrl })
        .from(products)
        .where(where)
        .orderBy(asc(products.id))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(products).where(where),
      loadPlaceholderUrlSet(this.database),
    ]);

    const items = rows.map(row => ({ ...row, imageStatus: classifyImageStatus(row.imageUrl, placeholderUrls) }));

    return { items, pagination: { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) } };
  }

}

export type AdminProductsListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  brand?: string;
  category?: string;
  imageState?: ImageStatus | 'all';
  overrideState?: 'all' | 'has_override' | 'inherit';
  exclusionReason?: string;
};
