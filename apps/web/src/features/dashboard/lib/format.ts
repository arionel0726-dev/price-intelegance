import type { PricePosition } from '../types/dashboard'

// Plain-language, business-safe labels - never raw internal enum values
// (ruleDecision/aiVerdict/retryEligibleAt) anywhere in the visible UI.
export const POSITION_LABEL: Record<PricePosition, string> = {
	more_expensive: 'More expensive than competitor',
	cheaper: 'Cheaper than competitor',
	approximately_equal: 'Approximately equal'
}

export function formatMdl(value: number | null): string {
	if (value === null) return '—'
	return `${value.toLocaleString('ro-MD', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MDL`
}

// Always shows an explicit sign (+/-) - a gap's direction is the whole
// point of the number, so an unsigned "10%" reading as "more expensive"
// by convention alone is exactly the ambiguity this avoids.
export function formatGapPercent(value: number): string {
	const sign = value > 0 ? '+' : value < 0 ? '' : '±'
	return `${sign}${value.toFixed(1)}%`
}

export function formatGapAmount(value: number): string {
	const sign = value > 0 ? '+' : value < 0 ? '' : ''
	return `${sign}${value.toLocaleString('ro-MD', { maximumFractionDigits: 2 })} MDL`
}

export function formatPercent(value: number): string {
	return `${value.toFixed(1)}%`
}

export function formatCount(value: number): string {
	return value.toLocaleString('ro-MD')
}
