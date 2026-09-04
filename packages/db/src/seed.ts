import {
	competitorProducts,
	competitorProductVariants,
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
	await db.delete(competitorProductVariants)
	await db.delete(competitorProducts)
	await db.delete(competitors)
	await db.delete(products)

	const insertedProducts = await db
		.insert(products)
		.values([
			{
				sourceKey: 'seed-100001',
				article: '100001',
				barcode: '3145891073607',
				brand: 'Chanel',
				name: 'Bleu de Chanel Eau de Parfum',
				category: 'Perfume',
				sex: 'Men',
				volume: '100 ml',
				color: null,
				imageUrl: null,
				price: '2199.00',
				regularPrice: '2199.00'
			},
			{
				sourceKey: 'seed-100002',
				article: '100002',
				barcode: '3614272648401',
				brand: 'Lancôme',
				name: 'La Vie Est Belle Eau de Parfum',
				category: 'Perfume',
				sex: 'Women',
				volume: '50 ml',
				color: null,
				imageUrl: null,
				price: '1899.00',
				regularPrice: '1899.00'
			},
			{
				sourceKey: 'seed-100003',
				article: '100003',
				barcode: '3348901486385',
				brand: 'Dior',
				name: 'Sauvage Eau de Parfum',
				category: 'Perfume',
				sex: 'Men',
				volume: '100 ml',
				color: null,
				imageUrl: null,
				price: '2499.00',
				regularPrice: '2499.00'
			},
			{
				sourceKey: 'seed-100004',
				article: '100004',
				barcode: '3274872440872',
				brand: 'Givenchy',
				name: 'Irresistible Eau de Parfum',
				category: 'Perfume',
				sex: 'Women',
				volume: '80 ml',
				color: null,
				imageUrl: null,
				price: '2099.00',
				regularPrice: '2099.00'
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
				externalId: 'seed-chanel-bleu',
				title: 'Bleu de Chanel Eau de Parfum',
				brand: 'Chanel',
				imageUrl: null,
				url: 'https://makeup.md/chanel-bleu-edp-100',
				currency: 'MDL'
			},
			{
				competitorId: brocard.id,
				externalId: 'seed-chanel-bleu',
				title: 'Chanel Bleu de Chanel EDP',
				brand: 'Chanel',
				imageUrl: null,
				url: 'https://brocard.md/chanel-bleu-edp-100',
				currency: 'MDL'
			},
			{
				competitorId: makeup.id,
				externalId: 'seed-lancome-lveb',
				title: 'La Vie Est Belle Eau de Parfum',
				brand: 'Lancôme',
				imageUrl: null,
				url: 'https://makeup.md/lancome-lveb-edp-50',
				currency: 'MDL'
			},
			{
				competitorId: aroma.id,
				externalId: 'seed-dior-sauvage',
				title: 'Dior Sauvage Eau de Parfum',
				brand: 'Dior',
				imageUrl: null,
				url: 'https://aroma.md/dior-sauvage-edp-100',
				currency: 'MDL'
			}
		])
		.returning()

	const chanelMakeup = insertedCompetitorProducts.find(
		item => item.externalId === 'seed-chanel-bleu' && item.competitorId === makeup.id
	)!

	const chanelBrocard = insertedCompetitorProducts.find(
		item => item.externalId === 'seed-chanel-bleu' && item.competitorId === brocard.id
	)!

	const lancomeMakeup = insertedCompetitorProducts.find(
		item => item.externalId === 'seed-lancome-lveb'
	)!

	const diorAroma = insertedCompetitorProducts.find(
		item => item.externalId === 'seed-dior-sauvage'
	)!

	const insertedVariants = await db
		.insert(competitorProductVariants)
		.values([
			{
				competitorProductId: chanelMakeup.id,
				externalId: 'seed-chanel-bleu-100',
				label: '100 ml',
				volume: '100 ml',
				price: '2099.00',
				available: true
			},
			{
				competitorProductId: chanelBrocard.id,
				externalId: 'seed-chanel-bleu-100',
				label: '100 ml',
				volume: '100 ml',
				price: '2350.00',
				available: true
			},
			{
				competitorProductId: lancomeMakeup.id,
				externalId: 'seed-lancome-lveb-50',
				label: '50 ml',
				volume: '50 ml',
				price: '1799.00',
				available: true
			},
			{
				competitorProductId: diorAroma.id,
				externalId: 'seed-dior-sauvage-100',
				label: '100 ml',
				volume: '100 ml',
				price: '2399.00',
				available: true
			}
		])
		.returning()

	const chanelMakeupVariant = insertedVariants.find(
		item => item.competitorProductId === chanelMakeup.id
	)!

	const chanelBrocardVariant = insertedVariants.find(
		item => item.competitorProductId === chanelBrocard.id
	)!

	const lancomeMakeupVariant = insertedVariants.find(
		item => item.competitorProductId === lancomeMakeup.id
	)!

	const diorAromaVariant = insertedVariants.find(
		item => item.competitorProductId === diorAroma.id
	)!

	await db.insert(matches).values([
		{
			productId: chanel.id,
			competitorProductVariantId: chanelMakeupVariant.id,
			source: 'algorithm',
			score: 95
		},
		{
			productId: chanel.id,
			competitorProductVariantId: chanelBrocardVariant.id,
			source: 'algorithm',
			score: 91
		},
		{
			productId: lancome.id,
			competitorProductVariantId: lancomeMakeupVariant.id,
			source: 'algorithm',
			score: 94
		},
		{
			productId: dior.id,
			competitorProductVariantId: diorAromaVariant.id,
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
