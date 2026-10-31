import { TRI_STATE_OPTIONS, triStateToOption, type TriStateOption } from '../lib/tri-state'
import type { TriState } from '../types/admin'

type TriStateControlProps = {
	label: string
	value: TriState
	disabled?: boolean
	onChange: (option: TriStateOption) => void
}

// A real 3-way segmented control with explicit "Inherit / Enabled /
// Disabled" labels - never a checkbox, which can't represent "inherit"
// at all. Keyboard-accessible via role="radiogroup"/role="radio".
export function TriStateControl({ label, value, disabled, onChange }: TriStateControlProps) {
	const current = triStateToOption(value)

	return (
		<div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded border border-hairline">
			{TRI_STATE_OPTIONS.map(option => {
				const active = option.value === current
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={active}
						disabled={disabled}
						onClick={() => onChange(option.value)}
						className={
							active
								? 'px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 disabled:opacity-50'
								: 'px-3 py-1.5 text-xs font-medium text-text-secondary bg-card hover:bg-surface disabled:opacity-50'
						}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
