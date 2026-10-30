import { apiFetch } from '@/lib/api/client'

import type { EnqueueJobInput, JobEventsPage, JobListPage, JobRun } from '../types/job'

export type GetJobsListParams = {
	page?: number
	limit?: number
	competitor?: string
	status?: string
}

export function getJobsList(params: GetJobsListParams) {
	return apiFetch<JobListPage>('/jobs/discovery', {
		params: {
			page: params.page,
			limit: params.limit,
			competitor: params.competitor,
			status: params.status
		}
	})
}

export function getJob(id: number) {
	return apiFetch<JobRun>(`/jobs/discovery/${id}`)
}

export type GetJobEventsParams = {
	page?: number
	limit?: number
}

export function getJobEvents(id: number, params: GetJobEventsParams = {}) {
	return apiFetch<JobEventsPage>(`/jobs/discovery/${id}/events`, {
		params: {
			page: params.page,
			limit: params.limit
		}
	})
}

export function enqueueJob(input: EnqueueJobInput) {
	return apiFetch<JobRun>('/jobs/discovery', {
		method: 'POST',
		body: JSON.stringify(input)
	})
}

export function stopJob(id: number) {
	return apiFetch<JobRun>(`/jobs/discovery/${id}/stop`, { method: 'POST' })
}
