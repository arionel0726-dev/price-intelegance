// Development: an absolute origin (http://localhost:3001), since the API
// runs on a different port than the web app.
// Production: a relative path ("/api"), so the browser sends requests to
// the SAME origin the page was served from (Nginx routes /api/* to the
// Nest container - see nginx/nginx.conf) - no CORS, no cross-origin cookie
// concerns. NEXT_PUBLIC_* vars are inlined at build time, so this is set as
// a build ARG in apps/web/Dockerfile, not read at container runtime.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type ApiFetchOptions = RequestInit & {
	params?: Record<string, string | number | boolean | undefined>
}

// Carries the HTTP status (and, when present, the Nest exception's own
// `message`) so a caller can distinguish e.g. a 409 "already resolved"
// conflict from a generic failure, instead of every non-2xx response
// collapsing into the same plain Error - see the AI Review feature's
// approve/reject mutations for the first consumer of this.
export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message)
		this.name = 'ApiError'
	}
}

export async function apiFetch<T>(
	path: string,
	options: ApiFetchOptions = {}
): Promise<T> {
	const { params, ...requestOptions } = options

	// IMPORTANT: `new URL(path, base)` requires `base` to itself be a valid
	// absolute URL - it throws on a relative base like "/api" (there is no
	// implicit document-origin fallback, in the browser or otherwise). Build
	// the path + query string manually instead and hand fetch() a plain
	// string; fetch() DOES resolve a relative string against the current
	// page origin, exactly like a normal same-origin request would.
	const query = new URLSearchParams()

	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				query.set(key, String(value))
			}
		}
	}

	const queryString = query.toString()
	const url = `${API_URL}${path}${queryString ? `?${queryString}` : ''}`

	const response = await fetch(url, {
		credentials: 'include',
		...requestOptions,
		headers: {
			'Content-Type': 'application/json',
			...requestOptions.headers
		}
	})

	// Auth endpoints handle their own 401s (e.g. a failed login attempt) -
	// only bounce to /login for calls to protected application routes.
	const isAuthEndpoint = path.startsWith('/auth')

	if (response.status === 401 && !isAuthEndpoint && typeof window !== 'undefined') {
		window.location.href = '/login'
	}

	if (!response.ok) {
		// Nest's exception filter returns { statusCode, message, error } -
		// read it best-effort (a non-JSON or empty body just falls back to
		// the generic message, never throws from inside this catch path).
		const message = await response
			.clone()
			.json()
			.then((body: { message?: string }) => body?.message)
			.catch(() => undefined)

		throw new ApiError(response.status, message ?? `API request failed: ${response.status}`)
	}

	return response.json() as Promise<T>
}
