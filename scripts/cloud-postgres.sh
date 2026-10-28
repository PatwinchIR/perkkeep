#!/usr/bin/env bash
# Starts a throwaway PostgreSQL 16 server inside a Claude Code cloud container (or any Linux box
# where the agent runs as root) and prepares it with scripts/local-postgres.mjs. Data lives in
# /var/lib/postgresql/perkkeep and disappears with the container. Not for the owner's Mac: there,
# use any local PostgreSQL 16+ and run `npm run local:postgres` directly.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
DATA=/var/lib/postgresql/perkkeep/data
PORT=54329
ADMIN_PASSWORD=${PERKKEEP_LOCAL_ADMIN_PASSWORD:-localadmin}
if [ ! -d "$DATA" ]; then
  mkdir -p "$(dirname "$DATA")"
  chown postgres:postgres "$(dirname "$DATA")"
  pw=$(mktemp)
  echo "$ADMIN_PASSWORD" >"$pw"
  chown postgres "$pw"
  (cd /tmp && runuser -u postgres -- "$BIN/initdb" -D "$DATA" -A scram-sha-256 --pwfile="$pw" -U postgres >/dev/null)
  rm -f "$pw"
fi
if ! runuser -u postgres -- "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  (cd /tmp && runuser -u postgres -- "$BIN/pg_ctl" -D "$DATA" \
    -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$(dirname "$DATA")/log.txt" start)
fi
PERKKEEP_LOCAL_ADMIN_URL="postgresql://postgres:${ADMIN_PASSWORD}@127.0.0.1:${PORT}/postgres" \
  node "$(dirname "$0")/local-postgres.mjs"
