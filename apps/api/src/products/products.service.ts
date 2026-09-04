import { Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  competitorProductVariants,
  competitorProducts,
  competitors,
  count,
  countDistinct,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  matches,
  or,
  productBarcodes,
  products,
  sql,
  type SQL,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import {
  CATEGORY_GROUPS,
  CATEGORY_GROUP_LABELS,
  isCategoryGroupKey,
} from './category-groups';

const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

export type ProductsListQuery = {
  page?: number;
  limit?: number;
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
  constructor(private readonly database: DatabaseService) {}

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
    const skuWhere = this.buildWhere(query);

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

    const [representatives, aggregates] = await Promise.all([
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
    ]);

    const representativeByGroupKey = new Map(representatives.map(row => [row.groupKey, row]));
    const aggregateByGroupKey = new Map(aggregates.map(row => [row.groupKey, row]));

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
  private buildWhere(query: ProductsListQuery): SQL | undefined {
    const conditions: SQL[] = [isNotNull(products.url)];

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

    const search = query.search?.trim();
    if (search) {
      const term = `%${search}%`;

      conditions.push(
        or(
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
        )!,
      );
    }

    return and(...conditions);
  }
}
