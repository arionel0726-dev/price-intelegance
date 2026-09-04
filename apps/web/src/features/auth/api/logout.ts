import { apiFetch } from '@/lib/api/client'

export function logout() {
	return apiFetch<{ authenticated: boolean }>('/auth/logout', {
		method: 'POST'
	})
}
