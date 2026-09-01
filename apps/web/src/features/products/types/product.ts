export type Product = {
	id: number
	article: string | null
	barcode: string | null

	brand: string
	name: string
	category: string | null
	volume: string | null

	imageUrl: string | null
	price: string | null

	createdAt: string
	updatedAt: string
}
