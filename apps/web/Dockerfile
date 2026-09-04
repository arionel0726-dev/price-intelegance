# Production image for the Next.js web app.
#
# Builds with the project's normal toolchain (bun, Turborepo) but the final
# runtime stage runs Next's `output: "standalone"` build (see
# apps/web/next.config.ts) - a minimal, self-contained server.js plus only
# the dependencies Next actually traced as used, not the full workspace
# node_modules tree.
#
# Build from the REPO ROOT: docker build -f apps/web/Dockerfile .

FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS deps
COPY . .
RUN bun install --frozen-lockfile

# `next build` (Turbopack + native SWC/sharp bindings) segfaults inside
# bun's own runtime in this container ("panic: Segmentation fault") even
# though the identical build succeeds outside Docker on the same host/arch -
# a bun-runtime issue specific to BUILDING, not Next/Turbopack itself, and
# not bun in general (bun correctly SERVES the built standalone app - see
# the runner stage). bun's own `node` inside the oven/bun image is just a
# wrapper back into bun itself, so it hits the same crash - use real Node
# for this one step. bun (fast, lockfile-accurate) still does the install.
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app .
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container runtime - this is what makes the browser call same-
# origin "/api/..." in production instead of a dev-only absolute URL. See
# apps/web/src/lib/api/client.ts.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /app/apps/web
RUN npx next build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone output's root becomes the new /app root: apps/web/server.js +
# a minimal node_modules. .next/static and public/ are NOT included in the
# standalone trace (Next docs) and must be copied in separately.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
