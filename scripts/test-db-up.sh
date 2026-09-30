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

REMOTE=false
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && REMOTE=true

apt_install() {
  apt-get install -y -q "$@" >/dev/null 2>&1 ||
    { apt-get update -q >/dev/null 2>&1 && apt-get install -y -q "$@" >/dev/null; }
}

# halfvec, which learn/0083 indexes video title vectors with, arrived in
# pgvector 0.7, and Ubuntu 24.04 ships 0.6.0. So a web session takes the
# build from the PostgreSQL project's own apt repository, the same line CI's
# pgvector/pgvector:pg16 image carries, built for the same PG16 server. The
# migrations recreate the database, so a cluster already running picks it up
# without a restart.
EXT=/usr/share/postgresql/16/extension
PGDG=https://apt.postgresql.org/pub/repos/apt

pgvector_version() { sed -n "s/^default_version = '\(.*\)'$/\1/p" "$EXT/vector.control" 2>/dev/null; }

pgvector_has_halfvec() {
  local v
  v="$(pgvector_version)"
  [ -n "$v" ] && [ "$(printf '%s\n0.7.0\n' "$v" | sort -V | head -1)" = "0.7.0" ]
}

ensure_pgvector() {
  if [ ! -f "$EXT/vector.control" ]; then
    echo "test-db: installing pgvector"
    apt_install postgresql-16-pgvector
  fi
  pgvector_has_halfvec && return 0
  echo "test-db: pgvector $(pgvector_version) has no halfvec; installing the build from apt.postgresql.org"
  local codename arch file tmp
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  arch="$(dpkg --print-architecture)"
  file="$(curl -fsS "$PGDG/dists/$codename-pgdg/main/binary-$arch/Packages.gz" | gunzip |
    awk '/^Package: postgresql-16-pgvector$/ { p = 1 } p && !f && /^Filename:/ { print $2; f = 1 }')"
  [ -n "$file" ] || { echo "test-db: apt.postgresql.org lists no postgresql-16-pgvector for $codename" >&2; return 1; }
  # Unpacked rather than installed: the package declares it breaks Ubuntu's
  # JIT bitcode for PG16 (built with an older LLVM), and the tests need only
  # the library and the extension scripts, not the bitcode.
  tmp="$(mktemp -d)"
  curl -fsS -o "$tmp/pgvector.deb" "$PGDG/$file"
  dpkg-deb -x "$tmp/pgvector.deb" "$tmp/root"
  cp "$tmp/root/usr/lib/postgresql/16/lib/vector.so" /usr/lib/postgresql/16/lib/
  cp "$tmp/root$EXT"/vector* "$EXT"/
  rm -rf "$tmp"
  pgvector_has_halfvec || { echo "test-db: pgvector is $(pgvector_version) after installing; halfvec needs 0.7" >&2; return 1; }
}

if ready; then
  if $REMOTE; then ensure_pgvector; fi
  echo "test-db: already up on $PORT"
  exit 0
fi

if ! $REMOTE; then
  echo "test-db: nothing answers on localhost:$PORT." >&2
  echo "Start a Postgres 16 with pgvector there, e.g." >&2
  echo "  docker run -d -p $PORT:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg16" >&2
  exit 1
fi

if [ ! -x "$PG_BIN/initdb" ]; then
  echo "test-db: installing postgresql-16"
  apt_install postgresql-16
fi
ensure_pgvector

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
