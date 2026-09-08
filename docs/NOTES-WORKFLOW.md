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

## The plan, as distinct from the notes

Notes are what is *wrong*; the plan (`/dev/plan`) is what is *planned* — the
features that were decided on, the steps that get you to each, and the steps
beneath those. Say **"work the plan"** or **"do plan #12"** in a session, or
press *Send to Claude* on a step, and `.claude/skills/plan` runs: read the
step's brief, claim it, build it against its "done when", verify, commit with
the step number in the subject, close it with a note. The full model is in
[PLAN-SPEC.md](PLAN-SPEC.md).

A request in the notes queue that turns out to be a body of work rather than
a fix belongs in the plan: add it there as a *proposed* feature with its
steps, mark the note `planned`, and say which step it became. The person
approves it on the plan page before anything is built.

The whole loop, then: small things go in as notes and get fixed; big
thoughts go in as ideas, get shaped into proposals by pressing *Shape into a
plan*, get approved and handed over on the plan page, and get built one step
a night. Corrections to what was built go back in as notes.
