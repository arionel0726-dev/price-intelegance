import type { NextConfig } from 'next'
import path from 'node:path'
const nextConfig: NextConfig = {
	/* config options here */
	reactCompiler: true,
	// Minimal, self-contained production runtime (see apps/web/Dockerfile) -
	// bundles only the traced dependencies into .next/standalone instead of
	// requiring the full node_modules tree in the runtime image.
	//
	// NOTE: middleware-manifest.json is EMPTY ({}) in every build of this
	// app regardless of this setting - that turned out to be a red herring
	// during deployment-prep smoke testing, not a sign proxy.ts is broken.
	// The actual false alarm was a stale price_session cookie left over
	// from earlier dev-server testing at a different port (cookies are NOT
	// port-scoped, so it was sent to this origin too) - verified with a
	// clean `curl` (no cookie) that proxy.ts redirects correctly. Left as a
	// comment here so a future "it's not redirecting!" investigation
	// doesn't waste time on the manifest again - check for a stray cookie
	// first.
	output: 'standalone',
	turbopack: {
		root: path.resolve(__dirname, '../..')
	},
	images: {
		remotePatterns: [
			{
				protocol: 'https',
				hostname: 'i.makeup.md'
			},
			{
				protocol: 'https',
				hostname: 'ovico.md'
			},
			{
				protocol: 'https',
				hostname: 'vizaje-nica.com'
			}
		]
	}
}

export default nextConfig
