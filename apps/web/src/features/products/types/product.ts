// A catalog card represents a "variant family" (sibling Vizaje SKUs sharing
// one variant_group_id, e.g. a perfume's volume ladder or a lipstick's shade
// range) grouped server-side - not one raw product row. `id` is a stable
// representative SKU id, used as both the React key and the /products/:id
// link target.
export type ProductFamily = {
	id: number

	brand: string
	name: string
	category: string | null

	// Only set when the family is a single SKU (variantCount === 1) - a
	// multi-variant card shouldn't imply one specific volume/color.
	volume: string | null
	color: string | null

	imageUrl: string | null

	// Minimum current price among the family's website-confirmed variants.
	// Show "from X MDL" when priceVaries, plain "X MDL" otherwise.
	price: string | null
	priceVaries: boolean

	variantCount: number
	// e.g. "4 volumes" / "8 shades" / "4 variants" - null for single-SKU families.
	variantLabel: string | null

	createdAt: string
	updatedAt: string
}

export type PaginationMeta = {
	page: number
	limit: number
	total: number
	// Website-confirmed SKU count for the same filter/search, alongside
	// `total` (family count).
	skuTotal: number
	totalPages: number
}

export type ProductsPage = {
	items: ProductFamily[]
	pagination: PaginationMeta
}

export type CategoryGroup = {
	key: string
	label: string
}

export type ProductFilters = {
	brands: string[]
	// Curated business-level groups (e.g. "perfume"/"Perfume"), not raw
	// Vizaje category strings - see apps/api/src/products/category-groups.ts.
	categories: CategoryGroup[]
}
