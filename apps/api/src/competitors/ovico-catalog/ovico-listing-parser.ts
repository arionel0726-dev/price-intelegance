import * as cheerio from 'cheerio';

// Catalog Ingestion v1 (OVICO) - parses a real OVICO brand-listing page
// (e.g. https://ovico.md/ru/armani) into one row per product card. Built
// and tested against a real saved response (see
// __fixtures__/ovico-armani-brand-page.html, captured via browser DevTools
// "Save response as" on 2026-11-01), not guessed from the existing per-SKU
// search parser - OVICO's brand pages are a different template (Mirasvit
// "MpBrand" Magento 2 extension, class "mpbrand-index-view") with their own
// markup. Confirmed facts this parser relies on:
//
// - No pagination observed: the Armani page (62 products) had no
//   toolbar/pager/pages CSS classes, no ?p=/page/N links, no rel=next/prev.
//   This parser only reads the single response it's given - a future
//   milestone can add a pagination step without changing this function's
//   shape if a bigger brand turns out to paginate.
// - JSON-LD on the page is a BreadcrumbList only, not product data - this
//   parser does not look at it.
// - The stable external id is the Magento product entity id, found on the
//   wishlist form's hidden "product" input (100% coverage in the sample -
//   present on every card). The product slug/URL is NOT reliable identity:
//   the sample contained a literal "-kopirovat" (Russian "copy") duplicate
//   artifact, and only ~43% of slugs even had a manufacturer-code suffix.
// - ~3% of cards show an "от" (from)-prefixed price instead of an exact
//   one, meaning the product is a Magento configurable/grouped product
//   with multiple real SKUs not resolvable from the listing alone. This
//   parser persists that as a single approximate-price placeholder (see
//   isApproximatePrice) rather than guessing at undiscovered detail-page
//   markup.
// - No discount/old-price markup and no out-of-stock markup were found
//   anywhere in the sample - see parseOvicoListingPage's return type and
//   the OVICO Catalog Ingestion v1 report for how that limitation is
//   documented; this parser never fabricates values for either.

export type ParsedOvicoListingProduct = {
	externalId: string;
	url: string;
	brandLabel: string | null;
	name: string;
	concentration: string | null;
	imageUrl: string | null;
	price: number | null;
	isApproximatePrice: boolean;
};

const PRODUCT_CARD_SELECTOR = '.product-card'
const PRICE_NUMBER_RE = /([\d\s ]+(?:[.,]\d+)?)\s*MDL/i

function parsePriceText(raw: string): { price: number | null; isApproximate: boolean } {
	const isApproximate = raw.includes('от')

	const match = raw.match(PRICE_NUMBER_RE)
	if (!match) return { price: null, isApproximate }

	const numeric = match[1].replace(/[\s ]/g, '').replace(',', '.')
	const price = Number(numeric)

	return { price: Number.isFinite(price) ? price : null, isApproximate }
}

// Parses every `.product-card` on the page into a row, deduped by external
// id - a product can legitimately appear twice in the raw markup (e.g. once
// in a "bestsellers" carousel, once in the main grid); the caller upserts
// by (competitorId, externalId) anyway, so this just avoids doing the work
// twice and returning a misleading "discovered" count.
export function parseOvicoListingPage(html: string): ParsedOvicoListingProduct[] {
	const $ = cheerio.load(html)

	const byExternalId = new Map<string, ParsedOvicoListingProduct>()

	$(PRODUCT_CARD_SELECTOR).each((_, el) => {
		const card = $(el)

		// Skip the outer wrapper div when cheerio also matches an ancestor
		// ".product-card" that merely CONTAINS a real card (the
		// "swiper-slide product-card" carousel wrapper) - only parse cards
		// with their own wishlist-form external id directly inside them.
		const externalId = card
			.find('form.add-to-wishlist-form input[name="product"]')
			.first()
			.attr('value')

		if (!externalId) return
		if (byExternalId.has(externalId)) return

		const url = card.find('a[href]').first().attr('href') ?? null
		if (!url) return

		const name = card.find('.product-card__name').first().text().trim()
		const brandLabel = card.find('.product-card__brand').first().text().trim() || null
		const concentration =
			card.find('.product-card__options span').first().text().trim() || null
		const imageUrl = card.find('img').first().attr('src') ?? null

		const priceText = card.find('.product-card__price-current').first().text()
		const { price, isApproximate } = parsePriceText(priceText)

		byExternalId.set(externalId, {
			externalId,
			url,
			brandLabel,
			name,
			concentration,
			imageUrl,
			price,
			isApproximatePrice: isApproximate
		})
	})

	return [...byExternalId.values()]
}
