#!/usr/bin/env bash
# Start the local test database the full `npm test` suite needs.
#
#   scripts/test-db-up.sh
#
# The RLS, status, coexistence and vault tests in tests/ connect to Postgres 16
# with pgvector on port 5433, the database CI runs as a service. A web session
# has neither, so sessions ran `vitest run lib` and left tests/ to CI, and on
# 23 September 2026 four failures in tests/ reached main that way and kept it
# red all day. This stands the database up so the merge gate
# (scripts/gate.sh) can run the suite CI runs.
#
# It does nothing when something already answers on 5433. On a web session it
# installs what is missing and starts a cluster under /var/tmp; about a minute
# the first time, a few seconds after. On anyone's own machine it only says
# what is missing, since installing a database there is theirs to decide.
#
# The session-start hook deliberately does not call this: most sessions never
# run tests/, and the gate is where the cost is worth paying.
set -euo pipefail

PORT=5433
PG_BIN=/usr/lib/postgresql/16/bin
DATA=/var/tmp/pg-test/data
LOG=/var/tmp/pg-test/log

ready() { pg_isready -q -h localhost -p "$PORT" 2>/dev/null; }

if ready; then
  echo "test-db: already up on $PORT"
  exit 0
fi

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "test-db: nothing answers on localhost:$PORT." >&2
  echo "Start a Postgres 16 with pgvector there, e.g." >&2
  echo "  docker run -d -p $PORT:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg16" >&2
  exit 1
fi

apt_install() {
  apt-get install -y -q "$@" >/dev/null 2>&1 ||
    { apt-get update -q >/dev/null 2>&1 && apt-get install -y -q "$@" >/dev/null; }
}

if [ ! -x "$PG_BIN/initdb" ]; then
  echo "test-db: installing postgresql-16"
  apt_install postgresql-16
fi
if [ ! -f /usr/share/postgresql/16/extension/vector.control ]; then
  echo "test-db: installing pgvector"
  apt_install postgresql-16-pgvector
fi

# Postgres refuses to run as root, so the cluster belongs to the postgres user.
as_pg() {
  if [ "$(id -u)" = "0" ]; then su postgres -c "$1"; else bash -c "$1"; fi
}

mkdir -p "$(dirname "$DATA")"
[ "$(id -u)" = "0" ] && chown postgres "$(dirname "$DATA")"

if [ ! -f "$DATA/PG_VERSION" ]; then
  echo "test-db: creating a cluster in $DATA"
  as_pg "$PG_BIN/initdb -D $DATA -A trust -U postgres >/dev/null"
fi

echo "test-db: starting on $PORT"
as_pg "$PG_BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $LOG -w start >/dev/null"

ready || { echo "test-db: did not come up; see $LOG" >&2; exit 1; }
echo "test-db: up on $PORT"
