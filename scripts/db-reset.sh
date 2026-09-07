#!/usr/bin/env bash
# Drop and rebuild the LOCAL test database from supabase/migrations.
#
# This is the loop that keeps the migrations honest: they are the only
# definition of the schema, so if a policy or constraint only exists because
# someone clicked it into the Supabase dashboard, this script won't reproduce
# it and the RLS test will fail. That's the point.
#
# Two apps share this database, each owning a schema:
#
#   supabase/migrations             -> public,     the commerce side
#   supabase/migrations-job-search  -> job_search, the job search side
#   supabase/migrations-vault       -> obsidian,   the Obsidian mirror
#   supabase/migrations-todo        -> todo,       the todo module
#   supabase/migrations-learn       -> learn,      the learn module
#
# They are separate directories rather than one because the sets were numbered
# independently and each starts at 0001 -- and the job_search versions are
# already recorded remotely under exactly those numbers, so renaming them would
# make the local files disagree with the deployed history. Applying public
# first means tests/coexistence.test.ts sees a real neighbour rather than a
# fixture standing in for one; vault goes last because it is the newest and
# depends on nothing but auth.users.
set -euo pipefail

DB_URL="${TEST_DATABASE_URL:-postgresql://postgres@localhost:5433/shopping_manager_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# strip the database name to get an admin connection
BASE_URL="${DB_URL%/*}"
DB_NAME="${DB_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"

echo "==> resetting $DB_NAME"
psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 -q \
  -c "drop database if exists \"$DB_NAME\" with (force);" \
  -c "create database \"$DB_NAME\";"

echo "==> auth shim (local only)"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/local/00_auth_shim.sql"

# The order is phased, not directory-by-directory, because the two sets depend
# on each other in both directions and no single ordering of the directories
# satisfies both:
#
#   job_search/0006 hands ingestion to `core`, which public/0029 creates.
#   public/0031 onward repair job_search rows, so they need its tables.
#
# So: public up to the one that creates core, then all of job_search, then the
# rest of public, then vault. Running the directories straight through fails on
# public/0031 with "relation job_search.application_events does not exist",
# which is what this split exists to prevent.
CORE_HANDOVER="0030"

apply_file() {
  echo "==>   $(basename "$1")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"
}

# Files in $1 whose numeric prefix is <= $2 (when $3 is "upto") or > $2.
apply_range() {
  local dir="$1" bound="$2" mode="$3" f base num
  for f in "$ROOT/supabase/$dir"/*.sql; do
    base="$(basename "$f")"
    num="${base%%_*}"
    if [ "$mode" = "upto" ]; then
      [[ "$num" > "$bound" ]] && continue
    else
      [[ "$num" > "$bound" ]] || continue
    fi
    apply_file "$f"
  done
}

echo "==> migrations (through $CORE_HANDOVER, which creates core)"
apply_range migrations "$CORE_HANDOVER" upto

echo "==> migrations-job-search"
for f in "$ROOT/supabase/migrations-job-search"/*.sql; do apply_file "$f"; done

echo "==> migrations (after $CORE_HANDOVER, which repair job_search)"
apply_range migrations "$CORE_HANDOVER" after

echo "==> migrations-vault (obsidian)"
for f in "$ROOT/supabase/migrations-vault"/*.sql; do apply_file "$f"; done

echo "==> migrations-todo (todo)"
for f in "$ROOT/supabase/migrations-todo"/*.sql; do apply_file "$f"; done

echo "==> migrations-learn (learn)"
for f in "$ROOT/supabase/migrations-learn"/*.sql; do apply_file "$f"; done

echo "==> done"
