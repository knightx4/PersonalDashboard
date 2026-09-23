#!/usr/bin/env bash
# Run what CI runs on main, locally, before merging to main.
#
#   npm run gate
#
# The plan and notes skills used to check lint, `vitest run lib` and the build
# before merging, which left out tests/ (it needs a database) and the UI-law
# and contrast checks. On 23 September 2026 every one of the seven failures
# that kept main red came through those gaps. This is the same list as
# .github/workflows/ci.yml's check and design jobs, so a merge that passes here
# should pass there. When a step is added to CI, add it here too.
#
# Run it after merging origin/main into the working branch, so it checks what
# main will be. It stops at the first failure and names the step.
set -euo pipefail

cd "$(dirname "$0")/.."

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@localhost:5433/shopping_manager_test}"
# The build only checks these parse; CI uses the same placeholders.
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-placeholder-anon-key}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

step() {
  local name="$1"
  shift
  echo "==> gate: $name"
  if ! "$@"; then
    echo "gate: FAILED at $name" >&2
    exit 1
  fi
}

step "Test database" scripts/test-db-up.sh
step "Apply migrations" scripts/db-reset.sh
# Route types left in .next by an earlier build name pages main may since have
# removed, and tsc reads them. A fresh CI checkout has none.
rm -rf .next/types
step "Typecheck" npm run -s typecheck
step "Lint" npm run -s lint
step "Contrast" npm run -s check:contrast
step "UI laws" npm run -s check:ui
step "Test" npx vitest run
step "Build" npm run -s build

echo "gate: all clear"
