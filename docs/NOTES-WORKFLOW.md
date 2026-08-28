# Bug reports and feature requests

Capture is in the app; execution is a repeatable loop.

## Filing

The message button in the header, on every page. Bug or feature, a few
sentences, the submit code. It records the page you were on and your browser
alongside the text. `/feedback` lists everything and lets you set status and
priority by hand.

## Working them

Say **"knock out the notes"** in a session. That runs `.claude/skills/notes`,
which is the written procedure: claim one note, reproduce it, fix it, verify
(typecheck, lint, tests, build), commit it on its own with the note id in the
subject, close it with a one-line reason and the commit sha, then the next.

Nothing is closed without a reason. Anything that cannot be finished is marked
`blocked` with the exact question needed to unblock it, and every run ends by
listing what is blocked or still open.

## Statuses

`open` → `in_progress` → `done`, with `blocked` (waiting on an answer),
`planned` (deliberately deferred) and `declined` (will not do) as the escapes.
The last three always carry a reason.

## Priority

1 next, 2 normal, 3 someday. Bugs outrank features at equal priority. Set it
from `/feedback` or `npx tsx scripts/notes.ts priority <id> 1`.
