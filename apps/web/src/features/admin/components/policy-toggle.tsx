import { Check, X } from 'lucide-react'

type PolicyToggleProps = {
	label: string
	value: boolean
	disabled?: boolean
	onChange: (value: boolean) => void
}

// A clear text+icon toggle - never color-only. Used for the brand-level
// boolean policy columns (visibleInCatalog/makeupDiscoveryEnabled/
// ovicoDiscoveryEnabled/priceMonitoringEnabled), which are plain booleans
// (no inherit state at brand level, unlike the product tri-state override).
export function PolicyToggle({ label, value, disabled, onChange }: PolicyToggleProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={value}
			aria-label={`${label}: ${value ? 'enabled' : 'disabled'}`}
			disabled={disabled}
			onClick={() => onChange(!value)}
			className={
				value
					? 'inline-flex items-center gap-1.5 rounded border border-accent bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent disabled:opacity-50'
					: 'inline-flex items-center gap-1.5 rounded border border-hairline bg-card px-2.5 py-1 text-xs font-medium text-text-muted disabled:opacity-50'
			}
		>
			{value ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
			{value ? 'Enabled' : 'Disabled'}
		</button>
	)
}
