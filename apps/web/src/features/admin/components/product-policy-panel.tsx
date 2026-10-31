'use client'

import { AlertTriangle, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select'

import { useAdminProductDetail, usePatchProductPolicy } from '../queries/use-admin-products'
import { optionToTriState, reasonRequired, triStateToOption, type TriStateOption } from '../lib/tri-state'
import type { ExclusionReason } from '../types/admin'
import { TriStateControl } from './tri-state-control'

type ProductPolicyPanelProps = {
	productId: number
}

const EXCLUSION_REASONS: ExclusionReason[] = ['duplicate', 'discontinued', 'bad_data', 'wrong_product', 'internal', 'other']

// Backend-computed effective-policy diagnostics (never recomputed in the
// frontend - per the brief's explicit instruction) plus the 3 tri-state
// override controls. Every effective value shown here came straight from
// GET /admin/products/:id's response.
export function ProductPolicyPanel({ productId }: ProductPolicyPanelProps) {
	const { data, isLoading, isError } = useAdminProductDetail(productId)
	const patch = usePatchProductPolicy(productId)

	const [reasonNote, setReasonNote] = useState('')
	const [exclusionReason, setExclusionReason] = useState<ExclusionReason | ''>('')

	useEffect(() => {
		if (data?.override) {
			setReasonNote(data.override.reasonNote ?? '')
			setExclusionReason(data.override.exclusionReason ?? '')
		}
	}, [data?.override])

	if (isError) return <p className="text-sm text-text-muted">Failed to load policy diagnostics.</p>
	if (isLoading || !data) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-24 w-full rounded" />
			</div>
		)
	}

	const { effectivePolicy, override } = data

	function currentOptions() {
		return {
			catalog: triStateToOption(override?.catalogEnabledOverride ?? null),
			discovery: triStateToOption(override?.discoveryEnabledOverride ?? null),
			priceMonitoring: triStateToOption(override?.priceMonitoringEnabledOverride ?? null)
		}
	}

	function handleChange(dimension: 'catalogEnabledOverride' | 'discoveryEnabledOverride' | 'priceMonitoringEnabledOverride', option: TriStateOption) {
		const options = currentOptions()
		const nextOptions = {
			...options,
			...(dimension === 'catalogEnabledOverride' ? { catalog: option } : {}),
			...(dimension === 'discoveryEnabledOverride' ? { discovery: option } : {}),
			...(dimension === 'priceMonitoringEnabledOverride' ? { priceMonitoring: option } : {})
		}

		const anyDisabled = [nextOptions.catalog, nextOptions.discovery, nextOptions.priceMonitoring].some(reasonRequired)

		if (anyDisabled && !exclusionReason) {
			// Required only when force-disabling - never for force-enable or
			// inherit.
			return
		}

		patch.mutate({
			[dimension]: optionToTriState(option),
			...(anyDisabled ? { exclusionReason: exclusionReason || 'other', reasonNote: reasonNote || null } : {})
		})
	}

	const options = currentOptions()
	const anyDisabled = [options.catalog, options.discovery, options.priceMonitoring].some(reasonRequired)
	const needsReason = anyDisabled && !exclusionReason

	return (
		<div className="flex flex-col gap-5 rounded border border-hairline bg-surface p-4">
			{needsReason && (
				<div className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
					<AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
					Select a reason before force-disabling a dimension.
				</div>
			)}

			<div className="grid gap-4 sm:grid-cols-3">
				<DimensionBlock
					label="Catalog visibility"
					brandValue={effectivePolicy.catalog.brandValue}
					effective={effectivePolicy.catalog.effective}
				>
					<TriStateControl
						label="Catalog visibility override"
						value={override?.catalogEnabledOverride ?? null}
						disabled={patch.isPending}
						onChange={option => handleChange('catalogEnabledOverride', option)}
					/>
				</DimensionBlock>

				<DimensionBlock
					label="Price monitoring"
					brandValue={effectivePolicy.priceMonitoring.brandValue}
					effective={effectivePolicy.priceMonitoring.effective}
				>
					<TriStateControl
						label="Price monitoring override"
						value={override?.priceMonitoringEnabledOverride ?? null}
						disabled={patch.isPending}
						onChange={option => handleChange('priceMonitoringEnabledOverride', option)}
					/>
					<p className="mt-2 text-xs text-text-muted">{effectivePolicy.priceMonitoring.note}</p>
				</DimensionBlock>

				<DimensionBlock label="Discovery (product-level)" brandValue={null} effective={options.discovery !== 'inherit' ? optionToTriState(options.discovery) === true : null}>
					<TriStateControl
						label="Discovery override"
						value={override?.discoveryEnabledOverride ?? null}
						disabled={patch.isPending}
						onChange={option => handleChange('discoveryEnabledOverride', option)}
					/>
				</DimensionBlock>
			</div>

			{anyDisabled && (
				<div className="grid gap-3 sm:grid-cols-2">
					<div>
						<label className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted" htmlFor={`reason-${productId}`}>
							Exclusion reason
						</label>
						<Select value={exclusionReason} onValueChange={value => value && setExclusionReason(value as ExclusionReason)}>
							<SelectTrigger id={`reason-${productId}`} aria-label="Exclusion reason" className="w-full rounded border-hairline bg-card">
								<SelectValue placeholder="Select a reason" />
							</SelectTrigger>
							<SelectContent>
								{EXCLUSION_REASONS.map(reason => (
									<SelectItem key={reason} value={reason}>
										{reason.replace(/_/g, ' ')}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<label className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted" htmlFor={`note-${productId}`}>
							Note (optional)
						</label>
						<input
							id={`note-${productId}`}
							value={reasonNote}
							onChange={event => setReasonNote(event.target.value)}
							onBlur={() => {
								if (exclusionReason) patch.mutate({ exclusionReason, reasonNote: reasonNote || null })
							}}
							className="h-8 w-full rounded border border-hairline bg-card px-2.5 text-sm text-text-primary"
						/>
					</div>
				</div>
			)}

			<DiscoveryDiagnosticsBlock makeup={effectivePolicy.discovery.makeup} ovico={effectivePolicy.discovery.ovico} />
		</div>
	)
}

function DimensionBlock({
	label,
	brandValue,
	effective,
	children
}: {
	label: string
	brandValue: boolean | null
	effective: boolean | null
	children: React.ReactNode
}) {
	return (
		<div className="rounded border border-hairline bg-card p-3">
			<p className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">{label}</p>
			<div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
				{brandValue !== null && <span>Brand: {brandValue ? 'enabled' : 'disabled'}</span>}
				<span className="inline-flex items-center gap-1 font-medium text-text-primary">
					Effective:
					{effective ? <Check className="size-3.5 text-accent" aria-hidden="true" /> : <X className="size-3.5 text-destructive" aria-hidden="true" />}
					{effective === null ? '—' : effective ? 'Enabled' : 'Disabled'}
				</span>
			</div>
			<div className="mt-2">{children}</div>
		</div>
	)
}

function DiscoveryDiagnosticsBlock({
	makeup,
	ovico
}: {
	makeup: { brandValue: boolean | null; effective: boolean; hasMatch: boolean; discoveryAttemptStatus: string | null; retryEligibleAt: string | null }
	ovico: { brandValue: boolean | null; effective: boolean; hasMatch: boolean; discoveryAttemptStatus: string | null; retryEligibleAt: string | null }
}) {
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{([{ label: 'MAKEUP', data: makeup }, { label: 'OVICO', data: ovico }] as const).map(({ label, data }) => (
				<div key={label} className="rounded border border-hairline bg-card p-3 text-xs text-text-secondary">
					<p className="font-medium uppercase tracking-[0.06em] text-text-muted">Why isn&apos;t this searched? ({label})</p>
					<ul className="mt-2 flex flex-col gap-1">
						<li>Effective discovery enabled: <strong className="text-text-primary">{data.effective ? 'Yes' : 'No'}</strong></li>
						<li>Match already exists: <strong className="text-text-primary">{data.hasMatch ? 'Yes' : 'No'}</strong></li>
						<li>Last discovery_attempts status: <strong className="text-text-primary">{data.discoveryAttemptStatus ?? '—'}</strong></li>
						{data.retryEligibleAt && <li>Retry eligible at: <strong className="text-text-primary">{new Date(data.retryEligibleAt).toLocaleString('ro-MD')}</strong></li>}
					</ul>
				</div>
			))}
		</div>
	)
}
