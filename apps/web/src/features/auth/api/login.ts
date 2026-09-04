import { apiFetch } from '@/lib/api/client'

export type LoginResponse = {
	authenticated: boolean
	email: string
}

export function login(email: string, password: string) {
	return apiFetch<LoginResponse>('/auth/login', {
		method: 'POST',
		body: JSON.stringify({ email, password })
	})
}
