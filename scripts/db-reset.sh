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
#
# They are separate directories rather than one because the two sets were
# numbered independently and both start at 0001 -- and the job_search versions
# are already recorded remotely under exactly those numbers, so renaming them
# would make the local files disagree with the deployed history. Applying
# public first means tests/coexistence.test.ts sees a real neighbour rather
# than a fixture standing in for one.
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

for dir in migrations migrations-job-search; do
  echo "==> $dir"
  for f in "$ROOT/supabase/$dir"/*.sql; do
    echo "==>   $(basename "$f")"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
done

echo "==> done"
