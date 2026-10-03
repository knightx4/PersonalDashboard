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
npx tsx scripts/notes.ts list --all           # including closed, and likes
npx tsx scripts/notes.ts next                 # the open note to claim next
npx tsx scripts/notes.ts show <id>            # the note, and the thread under it
npx tsx scripts/notes.ts start <id>           # claim it (in_progress)
npx tsx scripts/notes.ts done <id> --note "…" [--commit <sha>]
                                              # close it; refused unless the
                                              # commit is on main
npx tsx scripts/notes.ts block <id> --note "…" # cannot proceed; say what is needed
npx tsx scripts/notes.ts decline <id> --note "…" # will not do; say why
npx tsx scripts/notes.ts priority <id> 1|2|3
npx tsx scripts/notes.ts laws          # the design laws; needs no database
```

Ids are shown truncated; the first 8 characters are enough for every command.

## Likes are not in the queue

The header button files three kinds of note: a bug, a feature request, and a
like. A like says something works and should be kept or extended. There is
nothing in it to fix, so a notes run never claims one: `list` and `next` leave
likes out, `start` refuses one, and the SQL below filters them the same way.
Leave them `open`. The weekly vision review reads them and closes them, and a
like closed by a notes run would be read as work nobody asked for.

## When the CLI cannot run

`DATABASE_URL` is not set in Claude Code on the web, so `scripts/notes.ts`
exits immediately there. That is the normal case for a scheduled run, not a
fault — fall back to the Supabase MCP tools against `feedback_items` and do
not spend the session diagnosing it.

Use the **`Supabase`** connector, `mcp__Supabase__*`. Project ref:
`asjztutnqxbecruvyrbj`. `feedback_items` is in `public`. Most of the app's own
tables are not: they are in a schema per workspace, such as `todo.`,
`job_search.`, `goals.`, `learn.`, `news.` and `core.`, and the vault's are in
`obsidian.`.

The procedure is identical, and these are the writes each command makes, so
the queue records the same thing either way:

```sql
-- list (never a like: see "Likes are not in the queue")
select id, kind, status, priority, page_path, body, created_at
from feedback_items where status in ('open','in_progress','blocked','planned')
  and kind <> 'like'
order by (kind = 'bug') desc, priority asc, created_at asc;

-- the thread under a note: what was added after it was filed, oldest first.
-- Read it before claiming the note. An answer to a blocked note arrives here
-- as an 'me' comment rather than on the end of the body, and so does anything
-- else written on the card afterwards.
select author, body, created_at from core.thread_turns
where ref = 'public.feedback_items:…' order by created_at;

-- start (a like is never claimed, so the update refuses one)
update feedback_items set status = 'in_progress' where id = '…' and kind <> 'like';

-- done (only once the note's commit is on origin/main: see "Done means on
-- main" below. Check it first, every time, with
--   git fetch origin && git merge-base --is-ancestor <sha> origin/main
-- and do not run this update if that exits non-zero.)
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

**Record each close** (done, blocked or declined) with
`core.record_dash_action`, in the same call as the update, so Home lists it
under what Dash did today with an Undo. The claim to `in_progress` is not
recorded; the close that follows it is.

```sql
select core.dash_before('public.feedback_items:<id>');
update feedback_items set status = 'done', resolution_note = '…',
  commit_sha = '…', completed_at = now() where id = '<id>';
select core.record_dash_action('<user_id>', 'public.feedback_items:<id>', 'update',
  'close_note', $s$Dash fixed your note about the stuck save button and closed it.$s$);
```

`dash_before` keeps the row as it was, for the Undo. The kind is
`close_note`, `block_note` or `decline_note`. The sentence is read on Home as
it is: it names Dash, says what happened to which note, and stays under 300
characters. If the call fails, the update in it is rolled back too, so fix
it and send both again. The `user_id` is the note's own.

## Statuses

| Status | Meaning |
|---|---|
| `open` | Filed, not started. |
| `in_progress` | Claimed right now, or committed and waiting for the batch to reach main. At most one being worked at a time. |
| `blocked` | Needs an answer or an external dependency. Reason required. |
| `planned` | Accepted, deliberately deferred to a later batch, or waiting on a proposed rule (`spec_change_id` set). |
| `done` | On main and verified. Carries a commit that main contains. |
| `declined` | Will not be done. Reason required. |

`blocked` and `planned` are the "pending" states. They are legitimate, but each
one is a debt: every run ends by listing them to the user.

## The loop

Run this for each note, one at a time. Do not start the next until the current
one is closed.

1. **Read the queue.** `list` orders it correctly: bugs before features, then
   priority, then oldest. Work it top to bottom. State the plan for the batch
   before starting — how many notes, and in what order.

   Before claiming anything, do the two checks in *Requests that point at a
   missing rule* below: settle the notes waiting on a spec change that has
   since been decided, and look for a request filed on three pages. A note
   that goes into a proposed rule leaves the batch.
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

   **Read the part you need, not the whole file.** Twenty-four files here are
   over forty thousand characters, and the largest are over a hundred and
   twenty thousand: `app/jobs/(app)/roles/[id]/panels.tsx` is roughly
   thirty-four thousand tokens, and `lib/plan/tree.ts`,
   `app/dev/plan/actions.ts` and `lib/plan/tree.test.ts` are fifteen to
   nineteen thousand each. Opening one whole to change twenty
   lines costs that once to read and again on every turn for the rest of the
   batch, because the session carries it to the end. `grep -n` for the symbol,
   then read around the line. Read a whole file only when you are changing most
   of it, and do not read back a file you just edited.

   **Send a search you cannot narrow to a subagent, with `model: haiku`.**
   "Which page renders this", "where is this validated", anything that means
   opening several files to find one answer. It reports the paths, the line
   numbers and a sentence, and those files cost you the sentence instead of
   their contents. Finding a symbol does not need the model that writes the
   fix. Keep the editing yourself, on the session's own model.
5. **Verify before closing.** Three, every time:
   - `npx tsc --noEmit -p tsconfig.json` — the whole project, about twenty-five
     seconds. Not narrowed: an edit in one file breaks types in another.
   - `npx eslint <the files you changed> --max-warnings 0`
   - `npx vitest run <the test files covering what you changed>`

   **Not the whole suite, and not `next build`.** Both run once over the
   finished batch, in *Pushing the batch* below, and again on main in CI.
   Running them per note runs them once per note for a batch that is merged
   as one commit. The exception is a note whose own fix is about the build or
   about a test the narrow run cannot reach: run what that note needs and say
   so when you close it.
6. **Commit the note on its own.** One note per commit, so a change can be
   traced back to the ask and reverted alone. End the subject with the short
   id: `Fix the shelf photo picker (note 3f9c1a2b)`.
7. **Do not close it yet.** Write down its id, its commit and the one-sentence
   resolution, and leave it `in_progress`. A note's commit on the batch branch
   is not shipped, and the queue must not say it is.
8. **Push once per batch**, not per note: merge the batch to main as in
   *Pushing the batch* below, and only then close each note in it, then
   report.

`node_modules` is empty on a fresh web container, so step 5 cannot run until
the dependencies are installed. The SessionStart hook in `.claude/hooks/`
does that before the session starts; if it has not run for some reason,
`npm install` first rather than reading the failure as a broken repo.

## Requests that point at a missing rule

When the person asks for the same thing on three different pages, the app is
missing a rule, and fixing each page leaves the fourth page to be asked about
next month. This is Part 5 of `docs/SPEC-LAYER-SPEC.md` (plan #1526). One note
on one page is still fixed on that page, as above.

**First, settle the notes already waiting on a rule.** A note linked to a
spec change (`feedback_items.spec_change_id`) sits in `planned` until the
person decides the change on `/dev/specs`:

```sql
select f.id, f.status, f.page_path, c.id as change_id, c.title, c.status as change_status,
       c.commit_sha, c.spec
from feedback_items f join spec_changes c on c.id = f.spec_change_id
where f.user_id = '…' and f.status = 'planned';
```

- **Applied:** the rule is in the spec on main. Close the note as done
  against the change's `commit_sha` (check it with `git merge-base
  --is-ancestor` as for any close), with a resolution naming the rule:
  `Covered by R9 in the core-and-dash spec, "Every delete asks first". The
  work to build it is on the plan.` Read the rule's number from the change's
  diff.
- **Declined:** the person wants it handled page by page. Put the note back
  to `open` with `resolution_note = null` and leave the link, so it is not
  grouped into the same rule again. It is then worked like any other note in
  this batch.
- **Proposed or approved:** leave it.

**Then look for a request filed on three pages.** Read every note of the
last 30 days, closed ones included, since a request fixed on one page last
week and asked again on two more is the pattern this is for:

```sql
select id, kind, status, page_path, created_at, spec_change_id, body
from feedback_items
where user_id = '…' and kind <> 'like' and created_at >= now() - interval '30 days'
order by created_at;
```

For each open note, decide which of the others ask for the same thing. Same
thing means the same behaviour wanted from the app, such as "ask before
deleting" on the todo, jobs and vault pages, not the same workspace or the
same words. Group them. A group whose notes are all on one page is just a
note with duplicates, and the check below says so.

For a group on three or more pages:

1. **Choose the spec.** The rule goes in the spec that governs every page in
   the group: the core spec for behaviour across workspaces, a workspace's
   own spec when all the pages are in it (`lib/specs/registry.ts`). Before
   drafting, check its `## Rules` and the open changes
   (`select id, title from spec_changes where user_id = '…' and status in
   ('proposed', 'approved') and spec = '…'`). If a rule already covers the
   request, the rule is failing and the notes are bugs against it: fix them
   on their pages and name the rule in each close. If an open change already
   proposes it, link the notes to that change (`update feedback_items set
   spec_change_id = '<change>', status = 'planned' where id in (…) and
   user_id = '…'`) and draft nothing.
2. **Draft the change** as `.claude/skills/spec-audit/SKILL.md` says under
   *Writing the diff*: copy the spec to the scratchpad, add a `**Rn.**`
   sentence to `## Rules` with a `Checked by:` line (a count or a test where
   one can be written, `audit` otherwise), diff it, and check it with
   `scripts/apply-spec-diff.ts`. Title and why follow the same section, and
   the why cites the notes.
3. **Write the draft file** for `scripts/note-rule.ts`: the user, the spec
   slug, the section (`Rules`), the finding (what the notes keep asking for,
   in one or two sentences), the title, the why, the path to the diff, and
   the group's rows exactly as the query above returned them. Then:

   ```
   npx tsx scripts/note-rule.ts "$SCRATCH/rule.json" > "$SCRATCH/rule.sql"
   ```

   It counts only the notes from the last 30 days that are not likes,
   surface notes or already linked, and refuses unless they span three
   pages and at least one is open. A refusal means the group is not a rule:
   fix the notes on their pages.
4. **Run the statement** it printed through the connector. It drafts the
   change only while fewer than five are waiting, files the `missing_rule`
   finding that the spec's page in Dev shows, and links the notes, moving
   the open ones to `planned` with a line saying which rule they wait on.
   Closed notes are linked as evidence and keep their status.
5. **Read what came back.** A `change_id` means the rule is drafted and its
   notes leave this batch. A null `change_id` means five changes are already
   waiting: the finding is filed for the next spec audit, and the notes stay
   open. Leave them for a later run rather than fixing them one page at a
   time, and say so in the report.

Report each proposed rule under the closing table (*Proposed rules*). Never
approve the change; that is the person's press.

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

**Run the full gate once, before the merge.** These are the checks each note
skipped, and this is where they are paid for:

    npm run gate

It runs what CI runs on main: the test database, migrations, typecheck, lint,
contrast, UI laws, the whole test suite including tests/, and the build, in
three lanes side by side, and names every step that failed. Run it after merging
`origin/main` into the batch branch, so it checks what main will be. The old
gate was lint, `vitest run lib` and the build, and every failure that kept
main red on 23 September 2026 came through what that left out.

Anything that fails here belongs to whichever note broke it: fix it, and amend
or add a commit against that note. A failure another session merged is yours
too, since main is what you are about to push. Do not merge a batch that has not been
through this — the per-note checks were narrowed on the understanding that it
happens here.

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

Push main, then close the batch's notes, each against its own commit:
`done <id> --commit <sha> --note "…"`. This is the only place a note is
closed as done.

## Done means on main

A note is `done` only when main carries its commit. Committed on a branch,
pushed to a branch, or "merged later" are all `in_progress`. Note 89ad8bef was
closed with "not yet merged to main" in its own resolution, and the page said
Done about work that was nowhere the app could run it.

`notes.ts done` asks GitHub whether main contains the commit and refuses the
close when it does not, or when GitHub cannot be asked, the same guard
`plan.ts done` has. Doing the writes by hand does not make it optional:
before the `done` update, `git fetch origin` and
`git merge-base --is-ancestor <sha> origin/main`, and close only when that
exits zero. After a `--no-ff` merge the note's own commit is on main, so the
sha recorded is still the note's commit, not the merge.

When the batch cannot reach main (the gate will not pass, a conflict you
cannot resolve), push the batch branch so the work survives, and `block` each
note in it, naming the branch: `On claude/…, not merged: <what stopped it>`.
Never `done` with a branch in the resolution note.

## When a note cannot be finished

Mark it `blocked` immediately and move to the next one — do not stall the
batch. The note must say exactly what is needed, in a form the user can answer
in one line:

- Needs a decision → the options, and a recommendation. Only a real one: a
  choice you would recommend and the user would very likely accept is yours
  to make. Make it, and say what you chose in the note you close with.
- Needs a credential or access → which one, and where it goes.
- Needs information only the user has → the specific question.
- Too large for a batch → what it really involves, and a proposed split.

Never mark a note `done` with the fix unverified or off main, and never
silently drop one.

## When a note works against the vision

Each workspace has a vision on the specs page, saying what it is for, and the
app has one for the whole. Read the one for the note's workspace (the page path
says which) with `select module, body from module_visions where user_id = '…'`;
the app's is stored under `app`.

A note that asks for something the vision argues against is not yours to
settle by building it. Raise it, quoting the note and the passage of the vision
it contradicts, with the ask being whether the vision changes or the note is
declined. Then block the note, naming the raise. If part of the note does not
depend on the answer, such as a bug on the same screen, fix that part first and
say in the block note what was fixed.

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
`.claude/skills/plan/reference/offline.md`.

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
- **Proposed rules** — each spec change drafted from notes on three pages:
  its title, its spec, and the notes now waiting on it.
- **Still open** — anything not reached, and why the batch stopped there.
- The queue count after the run.
- Anything the user has to do themselves, such as a setting to change or a
  credential to add. A migration is not one of these: apply it yourself, as
  `CLAUDE.md` says.

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
