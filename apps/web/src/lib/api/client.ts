const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type ApiFetchOptions = RequestInit & {
	params?: Record<string, string | number | boolean | undefined>
}

export async function apiFetch<T>(
	path: string,
	options: ApiFetchOptions = {}
): Promise<T> {
	const { params, ...requestOptions } = options

	const url = new URL(path, API_URL)

	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) {
				url.searchParams.set(key, String(value))
			}
		}
	}

	const response = await fetch(url, {
		...requestOptions,
		headers: {
			'Content-Type': 'application/json',
			...requestOptions.headers
		}
	})

	if (!response.ok) {
		throw new Error(`API request failed: ${response.status}`)
	}

	return response.json() as Promise<T>
}
