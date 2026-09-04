# Deployment

Single-VPS deployment via Docker Compose + Nginx. This document is
operational, not architectural - see the in-code comments (`docker-compose.prod.yml`,
`nginx/nginx.conf`, each `Dockerfile`) for the reasoning behind specific choices.

Target topology:

```
Internet → HTTPS → Nginx → Next.js web (/)
                         → NestJS api (/api/*)
                                   → Python parser (internal only)
                                   → PostgreSQL (internal only)
```

Only Nginx's ports (80, and 443 once TLS is added) are published to the host.
Everything else stays on a private Docker network.

## Prerequisites

- A VPS with Docker + Docker Compose v2 installed.
- This repo checked out at e.g. `/opt/price-monitoring`.
- The private `JobVN.json` barcode-enrichment file, copied to the VPS
  **outside** the git checkout (e.g. `/opt/price-monitoring/private-data/JobVN.json`)
  - it must never be baked into a Docker image or committed.
- A domain pointed at the VPS (e.g. `price.vizaje-nica.com`) - not required to
  run the stack, only for real public HTTPS access.

## Environment setup

```bash
cp .env.production.example .env.production
```

Fill in real values - `POSTGRES_PASSWORD`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`
at minimum. Set `JOBVN_HOST_PATH` to the real path from the prerequisites
step. `.env.production` is gitignored - never commit it.

## Build / start

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

First run also creates the `postgres_data` and `vizaje_data` named volumes.
Check everything came up healthy:

```bash
docker compose -f docker-compose.prod.yml ps
```

## Migrations

Drizzle migrations are **not** run automatically on container start (a
silent auto-migrate on every restart is exactly the kind of implicit
destructive-migration risk this project has avoided elsewhere). Run them
explicitly, and always back up first:

```bash
./scripts/backup-db.sh
docker compose -f docker-compose.prod.yml exec api bun run --cwd ../../packages/db db:migrate
```

Deployment procedure for any release that includes new migrations:

```
backup → migrate → rebuild/restart containers
```

## First login

The app uses one shared internal account (`AUTH_EMAIL`/`AUTH_PASSWORD` from
`.env.production`) - there is no user table, no sign-up. Visit `https://<domain>/login`
and sign in with those credentials.

## Initial Vizaje sync

Do **not** rely on the local dev demo/seed data in production (see "Demo
seed data" below). After first migration, populate the real catalog:

```bash
docker compose -f docker-compose.prod.yml exec api bun run jobs:vizaje
```

This is the full website sync (~30-40 min) - safe to run from a plain
terminal since it runs inside the long-lived `api` container, not tied to
your SSH session's lifetime as long as you don't `docker compose down` mid-run
(use `screen`/`tmux`, or just accept the wait).

Then run competitor discovery gradually, NOT all at once:

```bash
docker compose -f docker-compose.prod.yml exec api bun run jobs:makeup-discovery 250
docker compose -f docker-compose.prod.yml exec api bun run jobs:ovico-discovery 15
```

Re-run discovery periodically (or enable the scheduler - see below) to
gradually cover the catalog. See `apps/api/src/jobs/*.job.ts` for the
per-job safety limits and rotation behavior.

## Enable the scheduler

Once the stack has been verified end-to-end (at least one full manual run of
each job succeeded), enable scheduled jobs by setting in `.env.production`:

```
ENABLE_SCHEDULED_JOBS=true
```

then:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api
```

Schedules (all `Europe/Chisinau`, see each `apps/api/src/jobs/*.job.ts`):

| Job | Schedule | Notes |
|---|---|---|
| Vizaje master sync | `0 2 * * *` (02:00 daily) | full website sync |
| MAKEUP refresh | `0 3 * * *` (03:00 daily) | known matches only, no search |
| OVICO refresh | `30 3 * * *` (03:30 daily) | known matches only, no search |
| MAKEUP discovery | `0 4 * * 0` (Sun 04:00) | 250/run default, cooldown-aware |
| OVICO discovery | `0 8 * * 0` (Sun 08:00) | 15/run default |

Scheduled jobs run **only** inside the long-lived `api` container - there is
no separate scheduler/worker service, and none should be added (see
`apps/api/src/jobs/job-lock.service.ts`).

## Manual job commands

Every scheduled job stays manually runnable, in or out of the scheduled
window:

```bash
docker compose -f docker-compose.prod.yml exec api bun run jobs:vizaje
docker compose -f docker-compose.prod.yml exec api bun run jobs:makeup-discovery [limit]
docker compose -f docker-compose.prod.yml exec api bun run jobs:makeup-refresh
docker compose -f docker-compose.prod.yml exec api bun run jobs:ovico-discovery [limit]
docker compose -f docker-compose.prod.yml exec api bun run jobs:ovico-refresh
```

**Known limitation**: the in-process job lock (`JobLockService`) only shares
state within one running Nest process. `docker compose exec` runs *inside*
the already-running `api` container/process, so it correctly shares the lock
with the live scheduler - a manual run during a scheduled window **will**
be correctly skipped (or will correctly block the scheduled one) rather than
running double. The limitation only applies to separately-*launched*
processes (e.g. two concurrent `docker compose exec` calls each spawning a
brand-new `bun run scripts/*.ts` **outside** the api container) - avoid
doing that. Operational rule: prefer `docker compose exec api bun run jobs:*`
(shares the lock) over anything that starts a second standalone process.

## Logs

```bash
docker compose -f docker-compose.prod.yml logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml ps
```

Stdout/stderr only for this milestone - jobs already emit one structured
JSON summary line per run (see `apps/api/src/jobs/job-envelope.ts`). No
Grafana/ELK/Sentry.

## Backup / restore

```bash
./scripts/backup-db.sh          # daily pg_dump, gzip, 7 daily + 4 weekly retention
./scripts/restore-db.sh <path>  # DESTRUCTIVE - confirms before running
```

Schedule the backup via host cron (see the script's header comment for the
exact crontab line). `./backups/` is gitignored - never commit it.

## Update deployment

```bash
git pull
./scripts/backup-db.sh
docker compose -f docker-compose.prod.yml exec api bun run --cwd ../../packages/db db:migrate   # only if new migrations
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## Rollback basics

```bash
git checkout <previous-tag-or-commit>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

If the rolled-back version needs the pre-migration schema, restore the
backup taken immediately before the migration was applied
(`./scripts/restore-db.sh <path>`). There is no automatic down-migration -
Drizzle migrations here are additive-only by convention (see project
history: `products.available`/`products.url` were added nullable, never a
destructive column change).

## Demo seed data

`packages/db/src/seed.ts` (demo Chanel/Lancôme products + `algorithm`-source
matches) exists for local development only. **Do not run `db:seed` in
production.** Production initialization is: migrations → Vizaje full sync →
competitor discovery (see above) - never the seed script. Existing local dev
data is left as-is; nothing about this milestone deletes it.

## TLS (not yet configured)

This milestone ships an HTTP-only Nginx config (`nginx/nginx.conf`) on
purpose - no domain/certificate was requested yet. To add HTTPS later: either
run Certbot on the host and mount the resulting certs into the `nginx`
container (add a `443 server` block + volume mounts for
`/etc/letsencrypt`), or add a `certbot` companion container. Either way,
uncomment the `443:443` port mapping in `docker-compose.prod.yml` once certs
exist.
