#!/bin/bash
#
# Write a run line for what the session just did, without the session waiting.
#
# Run lines used to be the session's own job, and most sessions skipped it, so
# the runner card on /dev/plan had nothing to say about what a session was
# doing. Registered in .claude/settings.json for PostToolUse and Stop, this
# hands the hook's JSON to scripts/run-line-hook.ts and returns at once; the
# script decides whether the call is worth a line (lib/plan/auto-line.ts) and
# writes it onto the run named in the session's brief.
#
# Only in a cloud session with the database to hand. A local session, or one
# with no DATABASE_URL, has no run to write to.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] || [ -z "${DATABASE_URL:-}" ]; then
  exit 0
fi

dir="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"
[ -x "$dir/node_modules/.bin/tsx" ] || exit 0

file="$(mktemp "${TMPDIR:-/tmp}/dash-run-line.XXXXXX")" || exit 0
cat > "$file"
nohup "$dir/node_modules/.bin/tsx" "$dir/scripts/run-line-hook.ts" "$file" >/dev/null 2>&1 &
exit 0
