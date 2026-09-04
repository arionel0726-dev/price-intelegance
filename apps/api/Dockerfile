# Production image for the NestJS API.
#
# Copies the WHOLE monorepo (not just apps/api) on purpose:
#   - it depends on the workspace package @price/db (packages/db)
#   - its operational CLI scripts (apps/api/scripts/*.ts - vizaje:sync,
#     jobs:*, etc.) run directly via `bun run scripts/foo.ts` in production
#     (see DEPLOYMENT.md) and resolve paths (e.g. data/vizaje/...) the same
#     relative way as in development - preserving the monorepo layout means
#     none of that path logic had to change for production.
# Runs on bun throughout (build AND runtime) so the compiled server and the
# raw-TS operational scripts share one runtime - no separate Node install.
#
# Build from the REPO ROOT: docker build -f apps/api/Dockerfile .

FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY . .
RUN bun install --frozen-lockfile

FROM deps AS builder
RUN bun run --filter=@price/db build
RUN bun run --filter=api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app /app

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["bun", "dist/main.js"]
