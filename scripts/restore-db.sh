#!/usr/bin/env bash
# Restore a backup produced by backup-db.sh. DESTRUCTIVE - drops and
# recreates the target database. Confirms before running.
#
# Usage: ./scripts/restore-db.sh backups/daily/price_20260101_010000.sql.gz
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_FILE="${1:?Usage: restore-db.sh <path-to-backup.sql.gz>}"

if [ ! -f "$BACKUP_FILE" ]; then
	echo "No such file: $BACKUP_FILE" >&2
	exit 1
fi

if [ -f .env.production ]; then
	# shellcheck disable=SC1091
	set -a
	source .env.production
	set +a
fi

POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER not set (source .env.production or export it)}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB not set}"

echo "This will DROP and recreate database '${POSTGRES_DB}' from ${BACKUP_FILE}."
read -r -p "Type the database name to confirm: " confirm
if [ "$confirm" != "$POSTGRES_DB" ]; then
	echo "Aborted."
	exit 1
fi

echo "[restore-db] stopping api (avoid writes during restore)"
docker compose -f docker-compose.prod.yml stop api

echo "[restore-db] dropping and recreating ${POSTGRES_DB}"
docker compose -f docker-compose.prod.yml exec -T postgres \
	psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"
docker compose -f docker-compose.prod.yml exec -T postgres \
	psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"

echo "[restore-db] loading ${BACKUP_FILE}"
gunzip -c "$BACKUP_FILE" | docker compose -f docker-compose.prod.yml exec -T postgres \
	psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[restore-db] starting api"
docker compose -f docker-compose.prod.yml start api

echo "[restore-db] done"
