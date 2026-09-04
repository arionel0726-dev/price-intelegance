import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// UX-only gate: checks whether the session cookie is present before letting
// a page render. Nest is the actual security boundary - it verifies the JWT
// on every API request regardless of what happens here.
const SESSION_COOKIE_NAME = 'price_session'

export function proxy(request: NextRequest) {
	const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value)
	const isLoginPage = request.nextUrl.pathname === '/login'

	if (!hasSession && !isLoginPage) {
		const loginUrl = new URL('/login', request.url)
		return NextResponse.redirect(loginUrl)
	}

	if (hasSession && isLoginPage) {
		return NextResponse.redirect(new URL('/', request.url))
	}

	return NextResponse.next()
}

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
