// Single source of truth for "is this price good or bad compared to that
// other price" - used by catalog cards, the list view, and the product
// detail page so the comparison rule is never duplicated or re-implemented
// per component.
export type PriceComparisonState = 'neutral' | 'favorable' | 'unfavorable'

export const PRICE_COMPARISON_CLASS: Record<PriceComparisonState, string> = {
	neutral: '',
	favorable: 'text-price-favorable',
	unfavorable: 'text-destructive'
}

function toNumber(price: string | number | null | undefined): number | null {
	if (price === null || price === undefined) return null

	const value = typeof price === 'number' ? price : Number(price)

	return Number.isFinite(value) ? value : null
}

// Compares `price` against `otherPrice` from `price`'s own point of view:
// lower is favorable, higher is unfavorable, equal or either side missing is
// neutral. Symmetric - call it once per side with the arguments swapped to
// get that side's own color.
export function comparePrices(
	price: string | number | null | undefined,
	otherPrice: string | number | null | undefined
): PriceComparisonState {
	const a = toNumber(price)
	const b = toNumber(otherPrice)

	if (a === null || b === null) return 'neutral'
	if (a < b) return 'favorable'
	if (a > b) return 'unfavorable'
	return 'neutral'
}
