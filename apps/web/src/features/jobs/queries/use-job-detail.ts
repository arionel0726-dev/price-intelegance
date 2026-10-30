import { useQuery } from '@tanstack/react-query'

import { getJob } from '../api/jobs-api'
import { nextPollDelay } from '../lib/job-polling'
import type { JobRun } from '../types/job'

export const jobDetailQueryKey = (id: number) => ['jobs', 'detail', id]

const ACTIVE_POLL_MS = 2500

// Polls fast while the job is live, stops entirely once it reaches a
// terminal status - a dead job never needs to be re-fetched on a timer
// again (a manual refetch/navigation still works normally). On a
// transient fetch error, the last-known JobRun stays on screen (React
// Query keeps `data` from the previous successful fetch by default) -
// the caller just also sees `isError`/`isRefetchError` turn true.
export function useJobDetail(id: number) {
	return useQuery({
		queryKey: jobDetailQueryKey(id),
		queryFn: () => getJob(id),
		enabled: Number.isFinite(id),
		refetchInterval: query => nextPollDelay((query.state.data as JobRun | undefined)?.status, ACTIVE_POLL_MS)
	})
}
