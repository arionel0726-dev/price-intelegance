import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getAdminImages, getDataQualitySummary, type GetAdminImagesParams } from '../api/admin-api'

export function useDataQualitySummary() {
	return useQuery({ queryKey: ['admin', 'data-quality', 'summary'], queryFn: getDataQualitySummary })
}

export function useAdminImages(params: GetAdminImagesParams) {
	return useQuery({
		queryKey: ['admin', 'data-quality', 'images', params.page, params.limit, params.imageState],
		queryFn: () => getAdminImages(params),
		placeholderData: keepPreviousData
	})
}
