import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getJobsList, type GetJobsListParams } from '../api/jobs-api'

export const jobsListQueryKey = (params: GetJobsListParams) => [
	'jobs',
	'list',
	params.page,
	params.limit,
	params.competitor,
	params.status
]

// Slower polling than the active job detail (history doesn't need
// second-by-second freshness) - a status change still shows up within a
// few polls. keepPreviousData avoids collapsing the table to a loading
// state on every page/filter change.
export function useJobsList(params: GetJobsListParams, options: { refetchInterval?: number | false } = {}) {
	return useQuery({
		queryKey: jobsListQueryKey(params),
		queryFn: () => getJobsList(params),
		placeholderData: keepPreviousData,
		refetchInterval: options.refetchInterval ?? 15000
	})
}
