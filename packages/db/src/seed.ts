import {
	competitorProducts,
	competitors,
	createDatabase,
	matches,
	products
} from './index.js'

const { db, client } = createDatabase(
	'postgresql://price:price@localhost:5432/price'
)

async function seed() {
	await db.delete(matches)
	await db.delete(competitorProducts)
	await db.delete(competitors)
	await db.delete(products)

	const insertedProducts = await db
		.insert(products)
		.values([
			{
				article: '100001',
				barcode: '3145891073607',
				brand: 'Chanel',
				name: 'Bleu de Chanel Eau de Parfum',
				category: 'Perfume',
				sex: 'Men',
				volume: '100 ml',
				color: null,
				imageUrl: null,
				price: '2199.00'
			},
			{
				article: '100002',
				barcode: '3614272648401',
				brand: 'Lancôme',
				name: 'La Vie Est Belle Eau de Parfum',
				category: 'Perfume',
				sex: 'Women',
				volume: '50 ml',
				color: null,
				imageUrl: null,
				price: '1899.00'
			},
			{
				article: '100003',
				barcode: '3348901486385',
				brand: 'Dior',
				name: 'Sauvage Eau de Parfum',
				category: 'Perfume',
				sex: 'Men',
				volume: '100 ml',
				color: null,
				imageUrl: null,
				price: '2499.00'
			},
			{
				article: '100004',
				barcode: '3274872440872',
				brand: 'Givenchy',
				name: 'Irresistible Eau de Parfum',
				category: 'Perfume',
				sex: 'Women',
				volume: '80 ml',
				color: null,
				imageUrl: null,
				price: '2099.00'
			}
		])
		.returning()

	const insertedCompetitors = await db
		.insert(competitors)
		.values([
			{
				name: 'MAKEUP',
				domain: 'makeup.md'
			},
			{
				name: 'Brocard',
				domain: 'brocard.md'
			},
			{
				name: 'Aroma',
				domain: 'aroma.md'
			}
		])
		.returning()

	const chanel = insertedProducts.find(item => item.article === '100001')!

	const lancome = insertedProducts.find(item => item.article === '100002')!

	const dior = insertedProducts.find(item => item.article === '100003')!

	const makeup = insertedCompetitors.find(item => item.name === 'MAKEUP')!

	const brocard = insertedCompetitors.find(item => item.name === 'Brocard')!

	const aroma = insertedCompetitors.find(item => item.name === 'Aroma')!

	const insertedCompetitorProducts = await db
		.insert(competitorProducts)
		.values([
			{
				competitorId: makeup.id,
				title: 'Bleu de Chanel Eau de Parfum 100 ml',
				imageUrl: null,
				price: '2099.00',
				url: 'https://makeup.md/chanel-bleu-edp-100',
				available: true
			},
			{
				competitorId: brocard.id,
				title: 'Chanel Bleu de Chanel EDP 100 ml',
				imageUrl: null,
				price: '2350.00',
				url: 'https://brocard.md/chanel-bleu-edp-100',
				available: true
			},
			{
				competitorId: makeup.id,
				title: 'La Vie Est Belle Eau de Parfum 50 ml',
				imageUrl: null,
				price: '1799.00',
				url: 'https://makeup.md/lancome-lveb-edp-50',
				available: true
			},
			{
				competitorId: aroma.id,
				title: 'Dior Sauvage Eau de Parfum 100 ml',
				imageUrl: null,
				price: '2399.00',
				url: 'https://aroma.md/dior-sauvage-edp-100',
				available: true
			}
		])
		.returning()

	const chanelMakeup = insertedCompetitorProducts.find(
		item => item.title === 'Bleu de Chanel Eau de Parfum 100 ml'
	)!

	const chanelBrocard = insertedCompetitorProducts.find(
		item => item.title === 'Chanel Bleu de Chanel EDP 100 ml'
	)!

	const lancomeMakeup = insertedCompetitorProducts.find(
		item => item.title === 'La Vie Est Belle Eau de Parfum 50 ml'
	)!

	const diorAroma = insertedCompetitorProducts.find(
		item => item.title === 'Dior Sauvage Eau de Parfum 100 ml'
	)!

	await db.insert(matches).values([
		{
			productId: chanel.id,
			competitorProductId: chanelMakeup.id,
			source: 'algorithm',
			score: 95
		},
		{
			productId: chanel.id,
			competitorProductId: chanelBrocard.id,
			source: 'algorithm',
			score: 91
		},
		{
			productId: lancome.id,
			competitorProductId: lancomeMakeup.id,
			source: 'algorithm',
			score: 94
		},
		{
			productId: dior.id,
			competitorProductId: diorAroma.id,
			source: 'manual',
			score: 100
		}
	])

	console.log('Seed completed')

	await client.end()
}

seed().catch(async error => {
	console.error(error)
	await client.end()
	process.exit(1)
})
