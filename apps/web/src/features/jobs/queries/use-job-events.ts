import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getJobEvents, type GetJobEventsParams } from '../api/jobs-api'
import { nextPollDelay } from '../lib/job-polling'
import type { JobStatus } from '../types/job'

export const jobEventsQueryKey = (jobId: number, params: GetJobEventsParams) => [
	'jobs',
	'events',
	jobId,
	params.page,
	params.limit
]

const ACTIVE_POLL_MS = 3000

// `jobStatus` comes from the already-polled job detail query rather than
// this query re-deriving it - avoids a second round trip just to decide
// whether to keep polling, and stays in lockstep with the detail view's
// own stop-on-terminal behavior.
export function useJobEvents(jobId: number, params: GetJobEventsParams, jobStatus: JobStatus | undefined) {
	return useQuery({
		queryKey: jobEventsQueryKey(jobId, params),
		queryFn: () => getJobEvents(jobId, params),
		enabled: Number.isFinite(jobId),
		placeholderData: keepPreviousData,
		refetchInterval: nextPollDelay(jobStatus, ACTIVE_POLL_MS)
	})
}
