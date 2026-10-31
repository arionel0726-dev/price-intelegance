// Milestone 5: Admin Control Center - types mirroring the exact response
// shapes returned by apps/api/src/admin/*.controller.ts (read directly,
// not guessed). Timestamps come back as ISO strings.

export type Brand = {
	canonicalKey: string
	displayName: string
	visibleInCatalog: boolean
	makeupDiscoveryEnabled: boolean
	ovicoDiscoveryEnabled: boolean
	priceMonitoringEnabled: boolean
	createdAt: string
	updatedAt: string
}

export type BrandPolicyPatch = Partial<
	Pick<Brand, 'visibleInCatalog' | 'makeupDiscoveryEnabled' | 'ovicoDiscoveryEnabled' | 'priceMonitoringEnabled'>
>

export type ImageStatus = 'missing' | 'placeholder' | 'real'

// Tri-state: null = inherit from brand, true = force-enabled, false =
// force-disabled. Mirrors product_policy_overrides' actual column
// nullability - never a checkbox, see lib/tri-state.ts.
export type TriState = boolean | null

export type ExclusionReason = 'duplicate' | 'discontinued' | 'bad_data' | 'wrong_product' | 'internal' | 'other'

export type ProductPolicyOverride = {
	productId: number
	catalogEnabledOverride: TriState
	discoveryEnabledOverride: TriState
	priceMonitoringEnabledOverride: TriState
	exclusionReason: ExclusionReason | null
	reasonNote: string | null
	createdAt: string
	updatedAt: string
	updatedBy: string | null
}

export type ProductPolicyPatch = {
	catalogEnabledOverride?: TriState
	discoveryEnabledOverride?: TriState
	priceMonitoringEnabledOverride?: TriState
	exclusionReason?: ExclusionReason | null
	reasonNote?: string | null
}

export type AdminProductEffective = {
	visibleInCatalog: boolean
	makeupDiscoveryEnabled: boolean
	ovicoDiscoveryEnabled: boolean
	priceMonitoringEnabled: boolean
}

export type AdminProductListItem = {
	id: number
	brand: string
	name: string
	category: string | null
	imageUrl: string | null
	imageStatus: ImageStatus
	url: string | null
	hasOverride: boolean
	exclusionReason: ExclusionReason | null
	updatedAt: string
	effective: AdminProductEffective
}

export type AdminProductsPage = {
	items: AdminProductListItem[]
	pagination: { page: number; limit: number; total: number; totalPages: number }
}

export type DiscoveryDiagnostic = {
	brandValue: boolean | null
	override: TriState
	effective: boolean
	hasMatch: boolean
	discoveryAttemptStatus: string | null
	retryEligibleAt: string | null
	lastCheckedAt: string | null
}

export type AdminProductDetail = {
	product: {
		id: number
		brand: string
		name: string
		category: string | null
		imageUrl: string | null
		url: string | null
	}
	override: ProductPolicyOverride | null
	brandPolicy: Brand | null
	effectivePolicy: {
		catalog: { brandValue: boolean | null; override: TriState; effective: boolean }
		priceMonitoring: { brandValue: boolean | null; override: TriState; effective: boolean; note: string }
		discovery: {
			makeup: DiscoveryDiagnostic
			ovico: DiscoveryDiagnostic
		}
	}
}

export type AdminSettings = {
	ai: { enabled: boolean; autoConfirmThreshold: number }
	operational: {
		discoveryNoMatchRetryDays: number
		discoveryErrorRetryHours: number
		productBudgetPresetsSeconds: number[]
		discoveryHeartbeatIntervalMs: number
		discoveryLeaseStaleMs: number
		makeupMaxSearchErrorRatio: number
		makeupMaxDeferredRatio: number
		makeupMaxCooldownEventsPerRun: number
		discoverySafetyMinSample: number
	}
}

export type AiSettingsPatch = { enabled?: boolean; autoConfirmThreshold?: number }

export type DataQualitySummary = {
	images: Record<ImageStatus, number>
	productsWithNoUrl: number
	productsWithEmptyBrand: number
	productsByExclusionReason: Array<{ reason: string | null; total: number }>
}

export type AdminImageListItem = {
	id: number
	brand: string
	name: string
	imageUrl: string | null
	imageStatus: ImageStatus
}

export type AdminImagesPage = {
	items: AdminImageListItem[]
	pagination: { page: number; limit: number; total: number; totalPages: number }
}

export type PlaceholderEntry = {
	imageUrl: string
	note: string | null
	confirmedAt: string
	confirmedBy: string | null
	affectedProductCount: number
}

export type PlaceholderCandidate = {
	imageUrl: string
	occurrences: number
	sample: Array<{ id: number; brand: string; name: string }>
}
