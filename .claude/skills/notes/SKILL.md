---
name: notes
description: Work the queue of in-app bug reports and feature requests in feedback_items — triage, fix one at a time, verify, commit, and close each with a reason. Use when the user says "knock out the notes", "work my feedback", "do my bug reports", or asks what is outstanding.
---

# Working the notes queue

Notes are bug reports and feature requests the user files from the header
button in the app. They live in the `feedback_items` table. This skill is the
procedure for turning them into shipped changes without losing any.

**The rule that matters: the queue must always tell the truth.** A note is
never left in a state that misrepresents reality. If something cannot be
finished, it is marked `blocked` with the specific question — not left `open`
to look tidy, and not marked `done` because the session is ending.

## The tool

`scripts/notes.ts` needs `DATABASE_URL` (service role) in the environment.

```
npx tsx scripts/notes.ts list                 # the queue, in work order
npx tsx scripts/notes.ts list --all           # including closed
npx tsx scripts/notes.ts show <id>            # full text of one note
npx tsx scripts/notes.ts start <id>           # claim it (in_progress)
npx tsx scripts/notes.ts done <id> --note "…" # close it; records HEAD commit
npx tsx scripts/notes.ts block <id> --note "…" # cannot proceed; say what is needed
npx tsx scripts/notes.ts decline <id> --note "…" # will not do; say why
npx tsx scripts/notes.ts priority <id> 1|2|3
```

Ids are shown truncated; the first 8 characters are enough for every command.
If the CLI cannot reach the database, fall back to the Supabase MCP tools
against the `feedback_items` table — the procedure is identical.

## Statuses

| Status | Meaning |
|---|---|
| `open` | Filed, not started. |
| `in_progress` | Claimed right now. At most one at a time. |
| `blocked` | Needs an answer or an external dependency. Reason required. |
| `planned` | Accepted, deliberately deferred to a later batch. |
| `done` | Shipped and verified. Carries the commit. |
| `declined` | Will not be done. Reason required. |

`blocked` and `planned` are the "pending" states. They are legitimate, but each
one is a debt: every run ends by listing them to the user.

## The loop

Run this for each note, one at a time. Do not start the next until the current
one is closed.

1. **Read the queue.** `list` orders it correctly: bugs before features, then
   priority, then oldest. Work it top to bottom. State the plan for the batch
   before starting — how many notes, and in what order.
2. **Claim one.** `start <id>`. Read it with `show <id>` and re-read the page
   path — it says where the user was standing.
3. **Reproduce first, for bugs.** Find the actual cause in the code before
   changing anything. A fix for a guessed cause is how a note gets closed
   twice. If it cannot be reproduced, that is a `block`, with what you tried.
4. **Make the change.** Smallest change that genuinely fixes it. Do not fold
   unrelated cleanup into a note's commit.
5. **Verify before closing.** All four, every time:
   - `npx tsc --noEmit -p tsconfig.json`
   - `npx eslint app lib components scripts --max-warnings 0`
   - `npx vitest run lib` (two FX tests fail without network — that is
     pre-existing, everything else must pass)
   - `npx next build` when routes, pages, or server actions changed
6. **Commit the note on its own.** One note per commit, so a change can be
   traced back to the ask and reverted alone. End the subject with the short
   id: `Fix the shelf photo picker (note 3f9c1a2b)`.
7. **Close it.** `done <id> --note "what changed, in one sentence"`. The commit
   sha is recorded automatically from HEAD, so close it after committing.
8. **Push once per batch**, not per note, then report.

## When a note cannot be finished

Mark it `blocked` immediately and move to the next one — do not stall the
batch. The note must say exactly what is needed, in a form the user can answer
in one line:

- Needs a decision → the options, and a recommendation.
- Needs a credential or access → which one, and where it goes.
- Needs information only the user has → the specific question.
- Too large for a batch → what it really involves, and a proposed split.

Never mark a note `done` with the fix unverified, and never silently drop one.

## Closing report

End every run with:

- **Done** — one line each: what changed, and the commit.
- **Blocked** — one line each: the question, phrased so a one-line answer
  unblocks it.
- **Still open** — anything not reached, and why the batch stopped there.
- The queue count after the run.

If nothing is blocked and nothing is left open, say so plainly — that is the
target state.

## Ambiguity

A note written in five seconds on a phone will sometimes be unclear. Interpret
it the way the person who wrote it meant it, using the page path for context.
If two readings lead to materially different work, `block` it with both
readings rather than guessing — a wrong feature costs more than a question.
