#!/usr/bin/env bash
# Daily PostgreSQL backup for the production stack. Run from the repo root
# on the VPS, e.g. via a daily cron entry:
#   0 1 * * * cd /opt/price-monitoring && ./scripts/backup-db.sh >> /var/log/price-backup.log 2>&1
#
# Retention: 7 daily + 4 weekly, pruned by this script - no external/cloud
# backup target (not requested for this milestone).
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DAY_OF_WEEK="$(date +%u)" # 1 = Monday

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# Requires POSTGRES_USER / POSTGRES_DB to match the running stack - load
# from .env.production if present, allow override via the environment.
if [ -f .env.production ]; then
	# shellcheck disable=SC1091
	set -a
	source .env.production
	set +a
fi

POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER not set (source .env.production or export it)}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB not set}"

DAILY_FILE="$BACKUP_DIR/daily/price_${STAMP}.sql.gz"

echo "[backup-db] dumping ${POSTGRES_DB} -> ${DAILY_FILE}"
docker compose -f docker-compose.prod.yml exec -T postgres \
	pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$DAILY_FILE"

# Monday's daily backup doubles as that week's weekly backup.
if [ "$DAY_OF_WEEK" = "1" ]; then
	cp "$DAILY_FILE" "$BACKUP_DIR/weekly/price_${STAMP}.sql.gz"
fi

echo "[backup-db] pruning: keep 7 daily, 4 weekly"
find "$BACKUP_DIR/daily" -name "*.sql.gz" -mtime +7 -delete
ls -1t "$BACKUP_DIR/weekly"/*.sql.gz 2>/dev/null | tail -n +5 | xargs -r rm --

echo "[backup-db] done"
