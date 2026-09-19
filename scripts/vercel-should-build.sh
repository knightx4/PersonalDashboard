#!/usr/bin/env bash
# Vercel's Ignored Build Step: exit 1 to skip the build, 0 to run it.
#
# The overnight runner merges a feature at a time and a busy night lands a
# dozen merges. Each one is a production build, and on Hobby they queue one at
# a time. On 18 September that queue held the fix for the runner's own stall
# for nineteen minutes and then cancelled it, so production ran the bug for
# another two hours while the build slot went to a branch nobody reads.
#
# A good share of those merges change nothing the app serves: a spec, a test, a
# migration that was applied to the live project by hand the moment it was
# written, the plan skill's own instructions. Skipping those is not a trade
# against safety -- the files are not in the bundle, and CI has already run
# against them on GitHub.
#
# The rule is a denylist rather than an allowlist, deliberately: a path nobody
# has thought about yet builds. Getting that backwards would skip a build for a
# change that mattered, and the whole point is that the deployed app matches
# main.
set -euo pipefail

# Vercel sets these. Outside Vercel, compare against the previous commit so the
# script can be run by hand on a checkout to see what it would decide.
BEFORE="${VERCEL_GIT_PREVIOUS_SHA:-HEAD~1}"
AFTER="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# No previous commit to compare against -- a first deploy, a shallow clone, a
# force push. Build, because the alternative is skipping blind.
if ! git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
  echo "no previous commit to compare against; building"
  exit 0
fi

CHANGED="$(git diff --name-only "$BEFORE" "$AFTER")"

if [ -z "$CHANGED" ]; then
  echo "nothing changed; skipping"
  exit 1
fi

# Paths the built app never reads. `supabase/migrations*` is here because a
# migration is applied to the live project when it is written -- the repository
# copy is the record, and CLAUDE.md is what keeps that true.
IGNORED='^(docs/|tests/|supabase/migrations|\.claude/|\.github/|README\.md$|CLAUDE\.md$)'

if echo "$CHANGED" | grep -qvE "$IGNORED"; then
  echo "building; changed outside the ignored paths:"
  echo "$CHANGED" | grep -vE "$IGNORED" | sed 's/^/  /'
  exit 0
fi

echo "skipping; only these changed:"
echo "$CHANGED" | sed 's/^/  /'
exit 1
