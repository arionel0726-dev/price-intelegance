import { defineConfig } from 'drizzle-kit'

export default defineConfig({
	schema: './src/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',

	dbCredentials: {
		url: 'postgresql://price:price@localhost:5432/price'
	}
})
