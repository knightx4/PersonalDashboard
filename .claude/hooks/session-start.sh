#!/bin/bash
#
# Install this project's dependencies before a web session starts.
#
# A fresh container clones the repo without node_modules, so the first thing
# any session wanted to do -- typecheck, lint, run a test, build -- failed
# until someone noticed and ran an install by hand. That is a couple of
# minutes and several tool calls spent, every session, re-deriving the same
# fact. The routine that works the notes queue paid it every run.
#
# `npm install` rather than `npm ci`: the container image is cached after this
# hook completes, and install reuses what is already there instead of deleting
# node_modules and starting again. CI still runs `npm ci`, which is the right
# choice there and the wrong one here.
#
# Nothing else belongs in here. The full `npm test` suite needs a Postgres 16
# on port 5433 for the RLS and coexistence tests, but nothing a session
# usually runs does -- `npx vitest run lib`, eslint, tsc and `next build` all
# work with the dependencies alone. Standing a database up on every session
# start to serve the tests most sessions never run would cost far more than it
# saves.
set -euo pipefail

# Local machines have their own node_modules and their own opinions about when
# to install. This is only for the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm's progress chatter goes to stderr so this hook's stdout stays empty --
# a synchronous hook's stdout is session context, not a build log.
npm install --no-audit --no-fund 1>&2

echo "session-start: dependencies installed" 1>&2
