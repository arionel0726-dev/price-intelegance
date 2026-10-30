import { useMutation, useQueryClient } from '@tanstack/react-query'

import { enqueueJob } from '../api/jobs-api'

// On success, invalidate every cached jobs list/detail so the new job
// shows up immediately (active-jobs panel + history) without a full page
// reload. A 409 (a job is already active for this competitor - see
// job_runs_active_per_competitor) is surfaced via ApiError.message, which
// the New Job form renders as a clean inline explanation rather than a
// raw error.
export function useEnqueueJob() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: enqueueJob,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['jobs'] })
		}
	})
}
