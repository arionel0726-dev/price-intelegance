import { apiFetch } from '@/lib/api/client'

import type {
	AdminImagesPage,
	AdminProductDetail,
	AdminProductsPage,
	AdminSettings,
	AiSettingsPatch,
	Brand,
	BrandPolicyPatch,
	DataQualitySummary,
	PlaceholderCandidate,
	PlaceholderEntry,
	ProductPolicyPatch
} from '../types/admin'

// --- brands ---------------------------------------------------------

export function getBrands() {
	return apiFetch<Brand[]>('/admin/brands')
}

export function patchBrand(canonicalKey: string, patch: BrandPolicyPatch) {
	return apiFetch<Brand>(`/admin/brands/${encodeURIComponent(canonicalKey)}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	})
}

export function bulkPatchBrands(canonicalKeys: string[], patch: BrandPolicyPatch) {
	return apiFetch<Brand[]>('/admin/brands', {
		method: 'PATCH',
		body: JSON.stringify({ canonicalKeys, patch })
	})
}

// --- products ---------------------------------------------------------

export type GetAdminProductsParams = {
	page?: number
	limit?: number
	search?: string
	brand?: string
	category?: string
	imageState?: string
	overrideState?: string
	exclusionReason?: string
}

export function getAdminProducts(params: GetAdminProductsParams) {
	return apiFetch<AdminProductsPage>('/admin/products', { params })
}

export function getAdminProductDetail(id: number) {
	return apiFetch<AdminProductDetail>(`/admin/products/${id}`)
}

export function patchProductPolicy(id: number, patch: ProductPolicyPatch) {
	return apiFetch<unknown>(`/admin/products/${id}/policy`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	})
}

// --- settings ---------------------------------------------------------

export function getAdminSettings() {
	return apiFetch<AdminSettings>('/admin/settings')
}

export function patchAiSettings(patch: AiSettingsPatch) {
	return apiFetch<AdminSettings['ai']>('/admin/settings/ai', {
		method: 'PATCH',
		body: JSON.stringify(patch)
	})
}

// --- data quality ---------------------------------------------------------

export function getDataQualitySummary() {
	return apiFetch<DataQualitySummary>('/admin/data-quality/summary')
}

export type GetAdminImagesParams = { page?: number; limit?: number; imageState?: string }

export function getAdminImages(params: GetAdminImagesParams) {
	return apiFetch<AdminImagesPage>('/admin/data-quality/images', { params })
}

// --- placeholders ---------------------------------------------------------

export function getPlaceholders() {
	return apiFetch<PlaceholderEntry[]>('/admin/placeholders')
}

export function getPlaceholderCandidates(threshold: number) {
	return apiFetch<PlaceholderCandidate[]>('/admin/placeholders/candidates', { params: { threshold } })
}

export function addPlaceholder(imageUrl: string, note?: string | null) {
	return apiFetch<PlaceholderEntry>('/admin/placeholders', {
		method: 'POST',
		body: JSON.stringify({ imageUrl, note })
	})
}

export function updatePlaceholderNote(imageUrl: string, note: string | null) {
	return apiFetch<PlaceholderEntry>(`/admin/placeholders/${encodeURIComponent(imageUrl)}`, {
		method: 'PATCH',
		body: JSON.stringify({ note })
	})
}

export function removePlaceholder(imageUrl: string) {
	return apiFetch<void>(`/admin/placeholders/${encodeURIComponent(imageUrl)}`, { method: 'DELETE' })
}
