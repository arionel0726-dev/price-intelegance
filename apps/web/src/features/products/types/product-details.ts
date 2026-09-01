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
		createdAt: string
		updatedAt: string
	}

	competitors: Array<{
		id: number
		competitorName: string
		title: string
		imageUrl: string | null
		price: string | null
		url: string
	}>

	similarProducts: Array<{
		id: number
		brand: string
		name: string
		volume: string | null
		imageUrl: string | null
		price: string | null
	}>
}
