import { defineConfig } from 'drizzle-kit'

// Falls back to the local dev default so nothing changes for existing
// workflows - production (and any non-default local setup) sets DATABASE_URL
// explicitly. Without this, `drizzle-kit migrate` run inside the api
// container would try "localhost:5432" - there is no Postgres in that
// container, only in the separate "postgres" service reached via Docker DNS.
export default defineConfig({
	schema: './src/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',

	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgresql://price:price@localhost:5432/price'
	}
})
