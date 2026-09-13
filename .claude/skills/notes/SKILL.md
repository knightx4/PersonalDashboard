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
npx tsx scripts/notes.ts show <id>            # the note, and the thread under it
npx tsx scripts/notes.ts start <id>           # claim it (in_progress)
npx tsx scripts/notes.ts done <id> --note "…" # close it; records HEAD commit
npx tsx scripts/notes.ts block <id> --note "…" # cannot proceed; say what is needed
npx tsx scripts/notes.ts decline <id> --note "…" # will not do; say why
npx tsx scripts/notes.ts priority <id> 1|2|3
npx tsx scripts/notes.ts laws          # the design laws; needs no database
```

Ids are shown truncated; the first 8 characters are enough for every command.

## When the CLI cannot run

`DATABASE_URL` is not set in Claude Code on the web, so `scripts/notes.ts`
exits immediately there. That is the normal case for a scheduled run, not a
fault — fall back to the Supabase MCP tools against `feedback_items` and do
not spend the session diagnosing it.

Use the **`Supabase`** connector. The lowercase `supabase` server in
`.mcp.json` reports needing OAuth, which a non-interactive session cannot
complete; they are two entries for the same project. Project ref:
`asjztutnqxbecruvyrbj`. `feedback_items` is in `public` — the app's own tables
are not, they are under `todo.`, `job_search.`, `vault.` and so on.

The procedure is identical, and these are the writes each command makes, so
the queue records the same thing either way:

```sql
-- list
select id, kind, status, priority, page_path, body, created_at
from feedback_items where status in ('open','in_progress','blocked','planned')
order by (kind = 'bug') desc, priority asc, created_at asc;

-- the thread under a note: what was added after it was filed, oldest first.
-- Read it before claiming the note. An answer to a blocked note arrives here
-- as an 'me' comment rather than on the end of the body, and so does anything
-- else written on the card afterwards.
select author, body, created_at from dev_comments
where feedback_item_id = '…' order by created_at;

-- start
update feedback_items set status = 'in_progress' where id = '…';

-- done (after committing, so HEAD is the commit that did it)
-- For a surface note (page_path like '/preview?s=%') the resolution note must
-- start with the law, exactly as the CLI writes it: 'Law 13 — …'. The CLI
-- refuses without it; doing the writes by hand does not make that optional.
update feedback_items set status = 'done', resolution_note = '…',
  commit_sha = '…', completed_at = now() where id = '…';

-- block: no commit and no completion time, because it is not finished
update feedback_items set status = 'blocked', resolution_note = '…',
  commit_sha = null, completed_at = null where id = '…';

-- decline
update feedback_items set status = 'declined', resolution_note = '…',
  commit_sha = null, completed_at = now() where id = '…';
```

A note is never closed without a `resolution_note`. That rule is the CLI's,
and it does not stop applying because the writes are being made by hand.

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
2. **Claim one.** `start <id>`. Read it with `show <id>`, which prints the
   thread under the note as well as its text, and re-read the page path — it
   says where the user was standing. Read the thread before starting: an
   answer to a note that came back blocked is in there, and so is anything
   the user added after filing it.
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

`node_modules` is empty on a fresh web container, so step 5 cannot run until
the dependencies are installed. The SessionStart hook in `.claude/hooks/`
does that before the session starts; if it has not run for some reason,
`npm install` first rather than reading the failure as a broken repo.

## Surface notes: work the law, not the note

A note whose page path is `/preview?s=<id>` was filed from `/dev/surfaces`,
looking at a real surface at the width it is read. `list` shows these apart from
the rest, grouped by surface.

These are not defects in one screen. What is wrong with a screen that reads
badly is usually a habit, and the habit is everywhere. Fixed one at a time,
nineteen notes give nineteen patches and an app that still does not hang
together — which already happened once here.

1. **Read all of them before starting.** The pattern across five notes is the
   defect, and it is invisible when they arrive one at a time.
2. **Read the laws.** `npx tsx scripts/notes.ts laws`, or `/dev/ui` for the
   same laws with worked examples. Works without `DATABASE_URL`.
3. **Cluster by law.** Most land on 9 to 15. Several notes about different
   surfaces are usually one law.
4. **Fix the law everywhere**, not just on the surface in the note. Grep for the
   shape, not the screen.
5. **Close the cluster together**, naming the law:
   `done <id> --law 13 --note "…"`. Required for surface notes; the command
   refuses without it.
6. **`--law none` when no law fits.** The complaint is sound and the guide is
   short a law. Say which in `--note`, add it to `app/dev/ui/laws.ts` with a
   worked example in `app/dev/ui/page.tsx`, then close the batch.

One commit per law, not per note — the exception to "one note per commit"
above. Name the law in the subject: `Make scrolled lists lists, not cards
(law 13)`.

`check:ui` reads zero on plenty of surfaces that read badly. Shoot what you
changed (`npm run shoot -- <surface-id>`) and look at the pictures before
closing.

## Pushing the batch

Fetch with a plain `git fetch origin`. Naming refs — `git fetch origin main
<branch>` — aborts the **whole** fetch when one of them is missing, which is
the normal state of a working branch that has not been pushed yet. It fails
with `couldn't find remote ref`, updates nothing, and leaves `origin/main`
stale at whatever the clone saw. Every "how far ahead is this branch" question
asked afterwards gets a confidently wrong answer, and the batch nearly gets
merged on the strength of it.

Merge with `--no-ff`, subject `Merge the notes batch: …`, saying what was in
it. The merge commit is how a batch is found again later; a fast-forward
leaves the run with no shape at all.

## When a note cannot be finished

Mark it `blocked` immediately and move to the next one — do not stall the
batch. The note must say exactly what is needed, in a form the user can answer
in one line:

- Needs a decision → the options, and a recommendation.
- Needs a credential or access → which one, and where it goes.
- Needs information only the user has → the specific question.
- Too large for a batch → what it really involves, and a proposed split.

Never mark a note `done` with the fix unverified, and never silently drop one.

## When something belongs to nobody's note

Three places take something a session has to say, and they are not
interchangeable:

- **The notes queue** — `feedback_items`, this skill. What the user reported as
  wrong, or asked for.
- **A plan decision** — a `decision` step under one feature, in
  `.claude/skills/plan`. A question about that feature, answered before it is
  built.
- **A raise** — `raised_items`, read on `/dev/raised`. What a session ran into
  that belongs to no note and no one feature: a risk found in code it was only
  passing through, a question of taste, a thing it will not decide alone.

Without the third, that last kind goes in the transcript, where it is only
read by somebody who opens Claude.

**Read the raises at the start of a run**, before claiming a note. Open ones
say what the user is still waiting to be asked about; answered ones carry a
reply written while nothing was awake, and the answer is what to build
against:

```
npx tsx scripts/plan.ts raises
npx tsx scripts/plan.ts raise "…" --ask "…" --consequence "<action>: <what>"
                                            [--detail "…"] [--module <id>]
```

`DATABASE_URL` is not set on the web, so the SQL for both is in
`.claude/skills/plan/SKILL.md` under **When the CLI cannot run**.

`--ask` is required: the move you want back, in one sentence the user can
answer in one line. The detail is the evidence for it, not the ask itself.

**A session never answers or dismisses a raise.** That is the user's move on
`/dev/raised`, the same rule as never answering its own decision. A session
that answers its own question has no questions, only guesses with a paper
trail. Replying to an answer the user has written is the exception, and it is
a `claude` comment on the thread, not a close.

A raise is not a way to avoid finishing a note. A note that cannot be finished
is still `blocked` with the question, in the queue where the user works it.

## Closing report

**Always end a run with a table**, one row per note touched, whatever the
outcome — done, blocked, planned or declined. It is the first thing in the
report, not an appendix:

| Note | Type | Page | Issue | Result |
|---|---|---|---|---|
| `3f9c1a2b` | Bug | `/sell` | what they wrote, quoted or trimmed | One sentence: what changed and the commit, or what it is waiting on. |

For surface notes, say which law each one turned out to be, and where else that
law was broken and fixed — the count of other places is the thing worth
reporting, because it is the part the note itself could not see.

Keep Result to a single sentence. A blocked row says what would unblock it;
a declined row says why not. Never omit a note from the table to make the
run look tidier.

Then, below the table:

- **Blocked** — one line each: the question, phrased so a one-line answer
  unblocks it.
- **Raised** — anything written to `/dev/raised` during the run, by title, so
  the user knows a question is waiting there.
- **Still open** — anything not reached, and why the batch stopped there.
- The queue count after the run.
- Anything the user has to do themselves — a migration to apply, a setting to
  change, a credential to add.

Detail beyond the table is worth writing only where it changes what the user
would do next: a cause worth knowing, an assumption they may want to
overturn, a limit they should not discover later. Skip it otherwise.

If nothing is blocked and nothing is left open, say so plainly — that is the
target state.

## Ambiguity

A note written in five seconds on a phone will sometimes be unclear. Interpret
it the way the person who wrote it meant it, using the page path for context.
If two readings lead to materially different work, `block` it with both
readings rather than guessing — a wrong feature costs more than a question.
