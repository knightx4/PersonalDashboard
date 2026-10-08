# Bug reports and feature requests

Capture is in the app; execution is a repeatable loop.

## Filing

The message button in the header, on every page. Bug or feature, a few
sentences, the submit code. It records the page you were on and your browser
alongside the text. `/feedback` lists everything and lets you set status and
priority by hand.

### Triage on filing

Once a bug, request or idea has saved, the panel asks Jev five questions
about it in one call: bug or request, which workspace, how soon (next,
normal, someday), fix or plan, and which open note or idea, if any, asks for the same
thing. The duplicate question lists the first line of every open note and
every idea neither dismissed nor shaped. The answers and their confidences go
in the row's `triage` column (migration 0121) and show under "saved" in the
panel, under the note on `/dev/bugs` and under the idea on `/dev/ideas`.

An answer under 0.8 is shown with a "?", and a match under 0.8 reads "Might
repeat" rather than "Says the same as". No Haiku call stands behind an unsure
answer, because the notes run reads every note again when it works it. A
confident priority is written to a note's `priority` column; the kind the
person picked is never changed, and a match is named, never merged. Only an
account with `jev_enabled` is triaged. A like is not triaged. The code is in
`lib/feedback/triage.ts` and `lib/feedback/triage-run.ts`.

A trial of twelve hand-written notes against 36 open items on 29 September
2026: type right 12 of 12, all at 1.00; workspace right 12 of 12, 7 of them
at 0.8 or more; priority right 9 of 12, with two of the three misses under
0.8; duplicate right 11 of 12, and the miss was at 0.69, so it showed as a
maybe. Each call took 130 to 420 ms and read about 2,000 tokens.

The fifth question, fix or plan (plan #1674), is stored as `route` in the same
`triage` value and shown as "Fix" or "Plan", with a "?" under 0.8. A row
filed before it existed has no `route` and shows nothing for it. Its score on
the twelve trial notes is pending: the twelve were hand-written for the trial
and not kept, so they cannot be run again, and a score on a different twelve
would not be comparable with the other four. It is measured the first time
twelve notes are put through it and written here as a count out of twelve,
with how many were under 0.8.

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
