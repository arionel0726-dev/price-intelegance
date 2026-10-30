import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { stopJob } from '../api/jobs-api'
import { jobDetailQueryKey } from './use-job-detail'

export function useStopJob(jobId: number) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: () => stopJob(jobId),
		onSuccess: data => {
			queryClient.setQueryData(jobDetailQueryKey(jobId), data)
			queryClient.invalidateQueries({ queryKey: ['jobs'] })
		},
		onError: error => {
			toast.error(error instanceof Error ? error.message : 'Failed to stop the job')
		}
	})
}
