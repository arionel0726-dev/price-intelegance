// Imports the Vizaje-Nica master catalog from the local 1C export files into
// PostgreSQL. See data/vizaje/ - these files are local-only and gitignored.
//
// Usage: bun run db:import:vizaje
//
// Design notes (see conversation history for the full audit this is based on):
// - JobVN.json defines catalog membership; Pricevn.json only enriches it with
//   DiscountPrice (JobVN.Price == Pricevn.Price for 100% of unambiguous rows).
// - Raw ID_nom is NOT globally unique (~758 duplicate groups out of ~16.9k).
//   Most (676) are the same SKU under multiple barcodes; a small number (75)
//   are genuinely different products that collide on ID_nom in the source.
//   sourceKey is the deterministic, always-unique importer identity; sourceId
//   keeps the raw ID_nom for traceability only.
// - One products row per sellable 1C SKU - no parent/variant table.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'

import {
	createDatabase,
	normalizeBarcode,
	productBarcodes,
	products,
} from '../src/index.js'

// Drizzle needs the `excluded.<col>` SQL reference for onConflictDoUpdate sets
// that should take the incoming (proposed) row's value.
function sqlExcluded(column: string) {
	return sql.raw(`excluded.${column}`)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR =
	process.env.VIZAJE_DATA_DIR ?? path.resolve(__dirname, '../../../data/vizaje')

const JOB_PATH = path.join(DATA_DIR, 'JobVN.json')
const PRICE_PATH = path.join(DATA_DIR, 'Pricevn.json')

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgresql://price:price@localhost:5432/price'

const BATCH_SIZE = 500

type JobRow = {
	ID_nom: number
	Barcode: string | null
	Brand: string | null
	ShortDescriptionRus: string | null
	ShortDescriptionMD: string | null
	VariativeNomenclature: string | null
	VariativeName: string | null
	ColorVar: string | null
	VolumeVar: string | null
	Sex: string | null
	NomenclatureCategory1Parent2: string | null
	WarehouseName: string | null
	Price: number | null
	PriceWH: number | null
	QuantityBalance: number | null
}

type PriceRow = {
	ID_nom: number
	Price: number | null
	DiscountPrice: number | null
}

const IDENTITY_FIELDS: (keyof JobRow)[] = [
	'Brand',
	'ShortDescriptionRus',
	'ShortDescriptionMD',
	'VariativeNomenclature',
	'VolumeVar',
	'ColorVar',
]

// ---------------------------------------------------------------------------
// Barcode normalization - shared with the new website-sync barcode
// enrichment lookup, see packages/db/src/vizaje-barcode.ts.
// ---------------------------------------------------------------------------
// Name fallback
// ---------------------------------------------------------------------------

type NameSource = 'variativeName' | 'shortDescriptionRus' | 'warehouseName'

function cleanWarehouseName(raw: string): string {
	let cleaned = raw.trim()

	// Strip a leading legacy code token (digits/dots/dashes) followed by
	// whitespace, e.g. "195.02 Lip Brilliance" -> "Lip Brilliance".
	const leadingCode = cleaned.match(/^[\d.-]+\s+/)
	if (leadingCode) {
		cleaned = cleaned.slice(leadingCode[0].length)
	}

	// Strip a trailing quoted brand segment, e.g. `Lip Brilliance "ARTDECO"`.
	cleaned = cleaned.replace(/\s*"[^"]*"\s*$/, '')

	cleaned = cleaned.replace(/\s+/g, ' ').trim()

	// Never drop a product for an ugly name - fall back to the raw value if
	// cleanup confidence is low (i.e. nothing meaningful survived).
	return cleaned.length > 0 ? cleaned : raw.trim()
}

function resolveName(row: JobRow): { name: string; source: NameSource } {
	if (row.VariativeName?.trim()) {
		return { name: row.VariativeName.trim(), source: 'variativeName' }
	}

	if (row.ShortDescriptionRus?.trim()) {
		return { name: row.ShortDescriptionRus.trim(), source: 'shortDescriptionRus' }
	}

	return {
		name: cleanWarehouseName(row.WarehouseName ?? ''),
		source: 'warehouseName',
	}
}

// ---------------------------------------------------------------------------
// Identity fingerprint (fallback for a Category-C row with no usable barcode)
// ---------------------------------------------------------------------------

function fingerprintKey(row: JobRow): string {
	const parts = [
		row.Brand,
		row.VariativeName || row.ShortDescriptionRus || row.WarehouseName,
		row.VariativeNomenclature,
		row.VolumeVar,
		row.ColorVar,
		row.Sex,
	].map(v => (v ?? '').trim().toLowerCase())

	return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Grouping / classification
// ---------------------------------------------------------------------------

type ImportProduct = {
	sourceKey: string
	sourceId: string
	variantGroupId: string | null
	name: string
	nameSource: NameSource
	brand: string
	category: string | null
	sex: string | null
	volume: string | null
	color: string | null
	price: number | null
	regularPrice: number | null
	barcode: string | null
	barcodes: string[]
}

function identityDiffers(a: JobRow, b: JobRow): boolean {
	return IDENTITY_FIELDS.some(field => a[field] !== b[field])
}

function pickCanonical(rows: JobRow[]): JobRow {
	return [...rows].sort((a, b) => {
		const qa = a.QuantityBalance ?? 0
		const qb = b.QuantityBalance ?? 0
		if (qa !== qb) return qb - qa
		return (a.Barcode ?? '').localeCompare(b.Barcode ?? '')
	})[0]!
}

async function main() {
	console.log(`Reading ${JOB_PATH}`)
	const job: JobRow[] = JSON.parse(readFileSync(JOB_PATH, 'utf-8'))

	console.log(`Reading ${PRICE_PATH}`)
	const priceRows: PriceRow[] = JSON.parse(readFileSync(PRICE_PATH, 'utf-8'))

	console.log(`JobVN rows: ${job.length}, Pricevn rows: ${priceRows.length}`)

	// Precise (ID_nom, Price) join - Price is identical between the two files
	// for every unambiguous record (confirmed by audit), so this correctly
	// disambiguates duplicate ID_nom groups without needing a shared row id.
	const discountByIdAndPrice = new Map<string, number>()
	for (const p of priceRows) {
		if (p.DiscountPrice && p.DiscountPrice > 0) {
			discountByIdAndPrice.set(`${p.ID_nom}|${p.Price}`, p.DiscountPrice)
		}
	}

	const byId = new Map<number, JobRow[]>()
	for (const row of job) {
		const list = byId.get(row.ID_nom)
		if (list) list.push(row)
		else byId.set(row.ID_nom, [row])
	}

	const diagnostics = {
		categoryA: 0,
		categoryB: 0,
		categoryC: 0,
		categoryD: 0,
		singles: 0,
		malformedBarcodes: 0,
		barcodeNotes: [] as string[],
		nameFallback: { variativeName: 0, shortDescriptionRus: 0, warehouseName: 0 },
		activeDiscounts: 0,
		priceEqualsDiscount: 0,
		fingerprintFallbackUsed: 0,
	}

	const importProducts: ImportProduct[] = []

	for (const [idNom, rows] of byId) {
		if (rows.length === 1) {
			diagnostics.singles += 1
			importProducts.push(buildImportProduct(rows[0]!, String(idNom), discountByIdAndPrice, diagnostics))
			continue
		}

		const base = rows[0]!
		const anyIdentityDiffers = rows.slice(1).some(r => identityDiffers(base, r))

		if (anyIdentityDiffers) {
			// Category C: genuinely different products sharing one ID_nom.
			// Each row becomes its own product, disambiguated by barcode.
			diagnostics.categoryC += 1

			for (const row of rows) {
				const normalized = normalizeBarcode(row.Barcode)
				const sourceKey = normalized.value
					? `${idNom}:${normalized.value}`
					: `${idNom}:fp:${fingerprintKey(row)}`

				if (!normalized.value) diagnostics.fingerprintFallbackUsed += 1

				importProducts.push(
					buildImportProduct(row, sourceKey, discountByIdAndPrice, diagnostics, String(idNom)),
				)
			}
			continue
		}

		const stockPriceDiffers = rows.slice(1).some(
			r => r.Price !== base.Price || r.QuantityBalance !== base.QuantityBalance,
		)
		const barcodes = new Set(rows.map(r => r.Barcode).filter(Boolean))

		if (stockPriceDiffers) {
			diagnostics.categoryB += 1
		} else if (barcodes.size > 1) {
			diagnostics.categoryA += 1
		} else {
			diagnostics.categoryD += 1
		}

		// Category A/B/D: one product, all barcodes attached.
		const canonical = pickCanonical(rows)
		const product = buildImportProduct(canonical, String(idNom), discountByIdAndPrice, diagnostics)

		const extraBarcodes = rows
			.map(r => normalizeBarcode(r.Barcode).value)
			.filter((b): b is string => !!b)
		product.barcodes = [...new Set([...product.barcodes, ...extraBarcodes])]

		importProducts.push(product)
	}

	// sourceKey uniqueness must hold before we touch the database.
	const sourceKeyCounts = new Map<string, number>()
	for (const p of importProducts) {
		sourceKeyCounts.set(p.sourceKey, (sourceKeyCounts.get(p.sourceKey) ?? 0) + 1)
	}
	const collisions = [...sourceKeyCounts.entries()].filter(([, count]) => count > 1)

	console.log(`\nNormalized products: ${importProducts.length}`)
	console.log(`sourceKey collisions after normalization: ${collisions.length}`)
	if (collisions.length > 0) {
		console.error('FATAL: sourceKey collisions detected, aborting.')
		console.error(collisions.slice(0, 20))
		process.exit(1)
	}

	// Global barcode uniqueness: the same physical barcode must not be claimed
	// by two different sourceKeys. Drop conflicting duplicates deterministically
	// (keep the first product that claimed it) rather than letting the DB
	// upsert error out.
	const claimedBarcodes = new Map<string, string>() // barcode -> sourceKey
	for (const p of importProducts) {
		p.barcodes = p.barcodes.filter(b => {
			const owner = claimedBarcodes.get(b)
			if (owner && owner !== p.sourceKey) return false
			claimedBarcodes.set(b, p.sourceKey)
			return true
		})
		if (p.barcode && !p.barcodes.includes(p.barcode)) {
			p.barcode = p.barcodes[0] ?? null
		}
	}

	console.log('\nClassification:')
	console.log(`  standalone (single row): ${diagnostics.singles}`)
	console.log(`  category A (same SKU, multiple barcodes): ${diagnostics.categoryA}`)
	console.log(`  category B (same identity, price/stock disagreement): ${diagnostics.categoryB}`)
	console.log(`  category C (ID_nom collision, different products): ${diagnostics.categoryC}`)
	console.log(`  category D (exact duplicate rows): ${diagnostics.categoryD}`)
	console.log(`  fingerprint fallback used (no usable barcode in category C): ${diagnostics.fingerprintFallbackUsed}`)

	console.log('\nBarcode diagnostics:')
	console.log(`  malformed/discarded barcodes: ${diagnostics.malformedBarcodes}`)
	for (const note of diagnostics.barcodeNotes.slice(0, 15)) console.log(`    ${note}`)

	console.log('\nName fallback usage:')
	console.log(`  VariativeName: ${diagnostics.nameFallback.variativeName}`)
	console.log(`  ShortDescriptionRus: ${diagnostics.nameFallback.shortDescriptionRus}`)
	console.log(`  cleaned WarehouseName: ${diagnostics.nameFallback.warehouseName}`)

	console.log('\nPricing:')
	console.log(`  active discounts (DiscountPrice > 0): ${diagnostics.activeDiscounts}`)
	console.log(`  products imported with price == DiscountPrice: ${diagnostics.priceEqualsDiscount}`)

	// -------------------------------------------------------------------------
	// Persist
	// -------------------------------------------------------------------------

	const { db, client } = createDatabase(DATABASE_URL)

	console.log(`\nUpserting ${importProducts.length} products (batches of ${BATCH_SIZE})...`)

	const sourceKeyToId = new Map<string, number>()

	for (let i = 0; i < importProducts.length; i += BATCH_SIZE) {
		const batch = importProducts.slice(i, i + BATCH_SIZE)

		const rows = await db
			.insert(products)
			.values(
				batch.map(p => ({
					sourceId: p.sourceId,
					sourceKey: p.sourceKey,
					variantGroupId: p.variantGroupId,
					article: null,
					barcode: p.barcode,
					brand: p.brand,
					name: p.name,
					category: p.category,
					sex: p.sex,
					volume: p.volume,
					color: p.color,
					imageUrl: null,
					price: p.price != null ? p.price.toFixed(2) : null,
					regularPrice: p.regularPrice != null ? p.regularPrice.toFixed(2) : null,
				})),
			)
			.onConflictDoUpdate({
				target: products.sourceKey,
				set: {
					variantGroupId: sqlExcluded('variant_group_id'),
					barcode: sqlExcluded('barcode'),
					brand: sqlExcluded('brand'),
					name: sqlExcluded('name'),
					category: sqlExcluded('category'),
					sex: sqlExcluded('sex'),
					volume: sqlExcluded('volume'),
					color: sqlExcluded('color'),
					price: sqlExcluded('price'),
					regularPrice: sqlExcluded('regular_price'),
					updatedAt: new Date(),
				},
			})
			.returning({ id: products.id, sourceKey: products.sourceKey })

		for (const row of rows) sourceKeyToId.set(row.sourceKey, row.id)

		process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, importProducts.length)}/${importProducts.length}`)
	}
	console.log()

	const barcodeRows = importProducts.flatMap(p => {
		const productId = sourceKeyToId.get(p.sourceKey)
		if (!productId) return []
		return p.barcodes.map(barcode => ({ productId, barcode }))
	})

	console.log(`\nUpserting ${barcodeRows.length} product_barcodes rows...`)

	for (let i = 0; i < barcodeRows.length; i += BATCH_SIZE) {
		const batch = barcodeRows.slice(i, i + BATCH_SIZE)

		await db
			.insert(productBarcodes)
			.values(batch)
			.onConflictDoUpdate({
				target: productBarcodes.barcode,
				set: { productId: sqlExcluded('product_id') },
			})

		process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, barcodeRows.length)}/${barcodeRows.length}`)
	}
	console.log()

	console.log('\nImport complete.')

	await client.end()
}

function buildImportProduct(
	row: JobRow,
	sourceKey: string,
	discountByIdAndPrice: Map<string, number>,
	diagnostics: {
		malformedBarcodes: number
		barcodeNotes: string[]
		nameFallback: { variativeName: number; shortDescriptionRus: number; warehouseName: number }
		activeDiscounts: number
		priceEqualsDiscount: number
	},
	sourceIdOverride?: string,
): ImportProduct {
	const { name, source } = resolveName(row)
	diagnostics.nameFallback[source] += 1

	const normalizedBarcode = normalizeBarcode(row.Barcode)
	if (row.Barcode && !normalizedBarcode.value) {
		diagnostics.malformedBarcodes += 1
		if (normalizedBarcode.note) diagnostics.barcodeNotes.push(normalizedBarcode.note)
	} else if (normalizedBarcode.note) {
		diagnostics.barcodeNotes.push(normalizedBarcode.note)
	}

	const regularPrice = row.Price ?? null
	const discount = discountByIdAndPrice.get(`${row.ID_nom}|${row.Price}`) ?? null
	const activeDiscount = discount != null && discount > 0
	if (activeDiscount) diagnostics.activeDiscounts += 1

	const price = activeDiscount ? discount : regularPrice
	if (activeDiscount) diagnostics.priceEqualsDiscount += 1

	return {
		sourceKey,
		sourceId: sourceIdOverride ?? String(row.ID_nom),
		variantGroupId: row.VariativeNomenclature?.trim() || null,
		name,
		nameSource: source,
		brand: (row.Brand ?? '').trim() || 'Unknown',
		category: row.NomenclatureCategory1Parent2?.trim() || null,
		sex: row.Sex?.trim() || null,
		volume: row.VolumeVar?.trim() || null,
		color: row.ColorVar?.trim() || null,
		price,
		regularPrice,
		barcode: normalizedBarcode.value,
		barcodes: normalizedBarcode.value ? [normalizedBarcode.value] : [],
	}
}

main().catch(error => {
	console.error(error)
	process.exit(1)
})
