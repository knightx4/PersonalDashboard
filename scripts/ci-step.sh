#!/usr/bin/env bash
# Run one CI step and, if it fails, put the reason where GitHub shows it.
#
#   scripts/ci-step.sh "Apply migrations" ./scripts/db-reset.sh
#
# A failed step on its own shows only "Process completed with exit code 1" in
# the check panel, and the actual error sits in the raw log several clicks
# away. This keeps the step's output as it was and, on failure, adds the tail
# of that output twice: as an error annotation, which the check panel and the
# PR's checks tab list at the top, and as a section of the job summary, which
# has room for more lines and keeps their formatting.
#
# Outside GitHub Actions it only runs the command.
set -uo pipefail

name="$1"
shift

if [ -z "${GITHUB_ACTIONS:-}" ]; then
  exec "$@"
fi

log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status="${PIPESTATUS[0]}"

if [ "$status" -ne 0 ]; then
  # Colour codes read as noise once they leave the terminal.
  tail_text="$(sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$log" | tail -n 40)"

  # An annotation is one line, so newlines and the characters the workflow
  # command syntax reserves have to be escaped.
  message="${tail_text//'%'/'%25'}"
  message="${message//$'\r'/'%0D'}"
  message="${message//$'\n'/'%0A'}"
  echo "::error title=${name} failed (exit ${status})::${message}"

  {
    echo "### ✗ ${name} failed (exit ${status})"
    echo
    echo "Last 40 lines of output:"
    echo
    echo '```'
    echo "$tail_text"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi

rm -f "$log"
exit "$status"
