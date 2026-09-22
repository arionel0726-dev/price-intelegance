import { cn } from '@/lib/utils'

import { PRICE_COMPARISON_CLASS, type PriceComparisonState } from '../lib/price-comparison'

type PriceTextProps = {
	price: string | number | null | undefined
	state?: PriceComparisonState
	prefix?: string
	className?: string
}

// The one place that formats a price AND applies its comparison color -
// every price shown in the catalog, list view, or product detail page
// renders through this, so the two never drift apart.
export function PriceText({ price, state = 'neutral', prefix, className }: PriceTextProps) {
	if (price === null || price === undefined || price === '') {
		return <span className={className}>—</span>
	}

	const formatted = `${prefix ?? ''}${Number(price).toLocaleString('ro-MD')} MDL`

	return <span className={cn(PRICE_COMPARISON_CLASS[state], className)}>{formatted}</span>
}
