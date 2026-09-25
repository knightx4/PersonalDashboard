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
# main will be.
#
# The database comes up first, then three lanes run side by side, since run one
# after another the checks took seven minutes a step:
#
#   types   typecheck, then build. The build rewrites .next/types, which tsc
#           reads, so the two cannot overlap.
#   lint    lint, contrast, UI laws
#   test    the whole vitest suite, tests/ included
#
# Every lane runs to the end. Each failing step is named, with the tail of its
# output, and the gate fails if any did.
set -euo pipefail

cd "$(dirname "$0")/.."

export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres@localhost:5433/shopping_manager_test}"
# The build only checks these parse; CI uses the same placeholders.
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-placeholder-anon-key}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

step() {
  local name="$1"
  shift
  echo "==> gate: $name"
  if ! "$@"; then
    echo "gate: FAILED at $name" >&2
    exit 1
  fi
}

# Runs the steps of one lane in order, stopping the lane at its first failure,
# and writes the name of the step that failed to $LOGS/<lane>.failed.
lane() {
  local lane="$1"
  shift
  local name
  while [ $# -gt 0 ]; do
    name="$1"
    shift
    local cmd=()
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do
      cmd+=("$1")
      shift
    done
    [ $# -gt 0 ] && shift
    echo "==> gate: $name"
    if ! "${cmd[@]}" >>"$LOGS/$lane.log" 2>&1; then
      echo "$name" >"$LOGS/$lane.failed"
      return 1
    fi
    echo "    gate: $name passed"
  done
}

step "Test database" scripts/test-db-up.sh
step "Apply migrations" scripts/db-reset.sh
# Route types left in .next by an earlier build name pages main may since have
# removed, and tsc reads them. A fresh CI checkout has none.
rm -rf .next/types

start=$SECONDS
lane types "Typecheck" npm run -s typecheck -- "Build" npm run -s build &
types=$!
lane lint "Lint" npm run -s lint -- "Contrast" npm run -s check:contrast -- "UI laws" npm run -s check:ui &
lint=$!
lane test "Test" npx vitest run &
test=$!

failed=0
for pid in $types $lint $test; do
  wait "$pid" || failed=1
done

if [ "$failed" = 1 ]; then
  for l in types lint test; do
    [ -f "$LOGS/$l.failed" ] || continue
    echo >&2
    echo "gate: FAILED at $(cat "$LOGS/$l.failed")" >&2
    tail -n 60 "$LOGS/$l.log" >&2
  done
  exit 1
fi

echo "gate: all clear ($((SECONDS - start))s after migrations)"
