// Pure mapping between the DB's tri-state override (`true | false | null`)
// and the 3 explicit UI labels the brief requires ("Inherit / Enabled /
// Disabled" - never a checkbox, which can't represent "inherit" at all).
import type { TriState } from '../types/admin'

export type TriStateOption = 'inherit' | 'enabled' | 'disabled'

export function triStateToOption(value: TriState): TriStateOption {
	if (value === true) return 'enabled'
	if (value === false) return 'disabled'
	return 'inherit'
}

export function optionToTriState(option: TriStateOption): TriState {
	if (option === 'enabled') return true
	if (option === 'disabled') return false
	return null
}

export const TRI_STATE_OPTIONS: Array<{ value: TriStateOption; label: string }> = [
	{ value: 'inherit', label: 'Inherit' },
	{ value: 'enabled', label: 'Enabled' },
	{ value: 'disabled', label: 'Disabled' }
]

// A force-disable override is the only case the brief requires a reason
// for - force-enabling, or returning to inherit, never requires one
// (matches product_policy_overrides.exclusionReason/reasonNote being
// genuinely nullable in the schema, not enforced NOT NULL anywhere).
export function reasonRequired(option: TriStateOption): boolean {
	return option === 'disabled'
}
