// Milestone 6 - the ONE place the Vizaje-vs-competitor price gap is
// computed. Every dashboard endpoint (summary/brands/opportunities) goes
// through this instead of re-deriving the formula.
//
// Price basis (per the M6 brief - do not use regularPrice for either
// side):
//   Vizaje price      = products.price (the current customer-facing
//                        price - DiscountPrice-when-active else Price,
//                        per that column's own schema comment).
//   Competitor price   = competitor_product_variants.price for the
//                        SPECIFIC matched variant (never a family/
//                        sibling aggregate - see the Milestone 6 report's
//                        grain discussion).
//
// gapAmount  = vizajePrice - competitorPrice (MDL, positive = Vizaje
//              more expensive).
// gapPercent = (gapAmount / competitorPrice) * 100 - denominator is
//              ALWAYS the competitor price, never Vizaje's own price and
//              never an average of the two.

// Hardcoded per the brief ("not in app_settings") - a business framing
// choice for "close enough to call it even", not an operational pacing
// knob, so it does not belong in app_settings next to ai.* either; it
// lives here, named and commented, as the one place this tolerance is
// defined.
export const EQUAL_TOLERANCE_PERCENT = 1;

export type PricePosition = 'more_expensive' | 'cheaper' | 'approximately_equal';

export type PriceGap = {
	gapAmount: number;
	gapPercent: number;
	position: PricePosition;
};

// Callers must ensure competitorPrice > 0 before calling this (see the
// "comparable-price universe" filter in dashboard-eligibility.ts) - this
// function does not itself guard against a zero/negative denominator,
// since that is a data-validity question the caller already answers by
// deciding whether a row belongs in the comparable universe at all.
export function computeGap(vizajePrice: number, competitorPrice: number): PriceGap {
	const gapAmount = vizajePrice - competitorPrice;
	const gapPercent = (gapAmount / competitorPrice) * 100;

	let position: PricePosition;
	if (Math.abs(gapPercent) <= EQUAL_TOLERANCE_PERCENT) {
		position = 'approximately_equal';
	} else if (gapPercent > EQUAL_TOLERANCE_PERCENT) {
		position = 'more_expensive';
	} else {
		position = 'cheaper';
	}

	return { gapAmount, gapPercent, position };
}
