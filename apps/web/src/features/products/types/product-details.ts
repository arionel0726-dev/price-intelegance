export type VariantType = 'volume' | 'shade' | 'variant'

export type ProductDetailsResponse = {
	product: {
		id: number
		article: string | null
		barcode: string | null
		brand: string
		name: string
		category: string | null
		sex: string | null
		volume: string | null
		color: string | null
		imageUrl: string | null
		price: string | null
		url: string | null
		createdAt: string
		updatedAt: string
	}

	// How this product's siblings (if any) primarily differ - drives the
	// variant selector's button labels. Meaningless when siblings.length <= 1.
	variantType: VariantType

	// Every SKU in this product's variant family, including this product
	// itself - empty when the family has only one SKU (no selector shown).
	siblings: Array<{
		id: number
		volume: string | null
		color: string | null
		price: string | null
	}>

	competitors: Array<{
		id: number
		competitorName: string
		title: string
		imageUrl: string | null
		price: string | null
		url: string
	}>
}
