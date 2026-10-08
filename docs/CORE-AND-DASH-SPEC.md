# One core and one Dash

Every workspace in this app was built as its own small app, and each one
solved the same problems its own way: how to point at a row, how to comment on
it, how to say whose move it is, how Dash talks about it and changes it. This
spec replaces those copies with one shared layer that every workspace plugs
into, and replaces Dash's separate model paths with one assistant that works
through that layer.

The two halves are in one spec because each needs the other. One Dash that can
act anywhere needs one way to name the thing it is acting on, one place to
record what it did, and one thread to reply in. A shared thread or ledger with
four different assistants writing into it would keep the inconsistency it was
meant to remove.

> **Status:** decisions answered 2 October 2026, and shaped into proposed
> features on `/dev/plan`. Three features already proposed there became parts
> of this one; they are named under **Order of work**.
>
> **Held 3 October 2026.** Its seven features are blocked until
> [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) is in place. This becomes the first
> overhaul built that way: rules first, a design session in code, then steps
> rewritten from it. #1436, Ask Dash reliability, is not held.

## What there is today

These counts come from reading the code and migrations on 2 October 2026.

**Pointing at a row.** There are at least eight formats. The sources catalogue
(`lib/sources`) maps `schema.table` plus a ref to a page, and Dash's `open_row`
and memory use it. Alongside it: `schema.table:id` strings in `core.files.origin`
and `core.observations.evidence`; `source_table`, `source_id` and `link_ref` in
`core.timeline`; module plus one of 21 hit kinds in search; `kind` plus
`target_id` in `goals.links`; one nullable foreign key per target in
`todo.task_links` (12 of them), `job_search.notes` (5) and `dev_comments` (6);
`subject_kind` plus `subject_ref` in `core.conversations`; and agenda keys and
dismissal keys in Todo.

**Threads.** Five tables hold comment threads: `dev_comments`, `goals.comments`,
`job_search.notes` (used as the role thread), `core.file_comments` and
`core.conversations` with its turns. Maya keeps a sixth in `obsidian.maya_*`.
All of them mark the author as the person or Dash, and none can hold a thread
on a row outside its own workspace.

**Whose move.** The plan uses `on_you`, `with_dash`, `yours`, `waiting` and
others (`lib/plan/tree.ts`); goals use `on_you`, `with_claude`, `waiting` and
`settled` (`lib/goals/status.ts`), with their own words for each. No other
workspace says whose move anything is, and "waiting" never says on whom.

**What Dash did.** Two places record Dash's writes with an Undo:
`core.dash_changes` for Ask Dash and `goals.history` for goal runs. The role
thread overwrites a cover letter, the dev comment actions file ideas and
reword steps, and goal comments file facts, all with no record to undo from.

**Dash itself.** Four paths answer the person conversationally, each with its
own model, tools and limits.

| Path | Model | Can read | Can write |
|---|---|---|---|
| Ask Dash (`lib/talk/ask.ts`) | Sonnet | 15 lookup tools across every workspace | 4 kinds of proposal |
| @dash on dev rows (`lib/comments/ask.ts`) | Haiku | The row and its thread only | Ideas, notes, rewording, plan steps |
| @dash on goals (`lib/goals/ask.ts`) | Haiku | The goal map and its collections | Facts into collections, step handover |
| @dash on a role (`lib/jobs/role-thread`) | Sonnet | The role, evidence bank and profile | The cover letter |

Capture's "Log what happened" (Haiku, five goal moves with Undo) and Maya in
the vault (Opus with web search, its own retrieval) are two more. There are
about 60 separate model id constants and 97 places that create an Anthropic
client.

The effect for the person is that Dash knows different things and can do
different things depending on which box they typed into. @dash on a role can
write a cover letter but cannot add the follow-up todo. Ask Dash can see the
whole job search but can only propose a todo. And every fix to how Dash
replies has to be made four times.

## Part 1: One way to point at a row

A **ref** is a string `schema.table:id`, the format `core.files.origin` already
uses. `lib/core/refs.ts` holds three functions: `parseRef`, `refHref` (the page
for it) and `refTitles` (titles for a batch of refs, one query per table).

The registry behind them is the sources catalogue, extended. Every table a
person can open a page for gets an entry with its href and how to read its
title, whether or not Goals may read it as a source. The existing flag that
says whether a table is a source stays, and keeps meaning only that.

Existing formats keep working. New code takes refs, and search hits, timeline
rows and agenda items gain a `ref` field beside what they carry now, so that
any of them can be linked, commented on or handed to Dash the same way.

Refs carry no foreign key. A ref to a deleted row is shown as "no longer
there" and links nowhere. Ownership is checked when a ref is written, by a
database function that resolves it and confirms the row belongs to the user,
which is the rule `goals.links` already enforces with its trigger.

## Part 2: One thread on any row

`core.conversations` already has `subject_kind` and `subject_ref`, one
conversation per user and subject, and turns marked by author. It becomes the
one thread store. Its kinds become `row`, for a thread under any ref, and
`ask`, for an Ask Dash conversation with no subject. The existing `feed_card`
and `news_story` threads become `row` threads under their refs. A newsletter
story is a position in its issue rather than a row, so its thread sits under
its saved copy, `news.saved_stories:<id>`, which discussing a story already
creates. The ref is checked on insert like any other: a thread under a row of
another account's is refused.

One component, `<Thread subject={ref} />`, shows a thread, takes a new comment,
recognises `@dash`, and shows Dash's reply when it lands. It replaces the
thread on plan rows, ideas, raises, goal steps, files and roles, and adds one
to todo tasks, orders, inventory items, news stories and vault notes. The
role's notes stay as notes; only the conversation with Dash moves.

Dev rows, goals and roles keep their own @dash replies, because each offers
tools only it has. Every other thread, files first, is answered by one reply
keyed by the ref alone (`lib/thread/ask.ts`): it reads the whole row as the
person's session sees it, written out from its catalogue entry, and runs the
shared loop. A new thread gets Dash's replies without code of its own.

What happens to the threads already written is the first decision below.

## Part 3: One whose-move vocabulary

`lib/core/move.ts` defines five states and their words:

| State | Word | Meaning |
|---|---|---|
| `on_you` | On you | Nothing happens until the person acts. |
| `with_dash` | With Dash | Dash has it and will act on its next run. |
| `dash_working` | Dash is on it | A Dash run on it is in progress now. |
| `waiting` | Waiting on … | Someone else has to act. It names who, as a ref or a short text such as "recruiter at EliseAI". |
| `settled` | Done | |

The plan's and goals' vocabularies map onto these, `with_claude` becomes
`with_dash`, and one label component draws all five. Each workspace adds a
small function that says the move for its own kinds of row: an application
that has been sent is waiting on the company, a return inside its window is on
you, a todo is on you. Moves are worked out when read, not stored, except
`dash_working`, which comes from the runs in progress (Part 5).

An Ask Dash hand-off counts as one of those runs. When Dash hands a request
on, it names the row the request is about in `core.dash_handoffs.subject_ref`,
as a ref, and only a row a lookup returned or the page showed. While the
hand-off is pending or fired, the Jobs, Todo and Shopping pages read those
refs and `withRun` in `lib/core/move.ts` shows that row as `dash_working`. A
row with no move of its own stays without one.

## Part 4: One "on you" list

The Todo agenda already merges eight workspaces' obligations without copying
them, and is the right base. It gains sources for the plan and goal rows whose
move is on you, questions Dash has raised, and threads where Dash's turn was
the last one and asked something. Rows with no date go in an "On you, no date"
pile under the dated ones.

A **Waiting** view beside it lists everything whose move is `waiting`, grouped
by who it waits on. That is where "I applied, I'm waiting on them" lives,
instead of in each workspace's own list.

Home's Today section reads this list instead of assembling its own.

## Part 5: One record of what Dash did

`core.dash_changes` becomes `core.dash_actions` and records every write Dash
makes, from any surface:

- the surface it came from (Ask, a thread, capture, a scheduled run, a routine)
- the subject ref and, for a thread, the turn that caused it
- what was done, with the row's values before and after
- a status: `proposed`, `done`, `declined` or `undone`

Undo restores the before values, and is refused when the row has changed since
Dash wrote it, the same rule `goals.history` uses. Goal runs keep writing
`goals.history` and also write here, so there is one place to read.

A write that restoring one row cannot put back is still recorded, with the
sentence saying why in `undo.none`, and Home shows that sentence where the
Undo would be. A payment the mail sync worked out again from a new charge is
one, and so is a charge the receipt re-read moved between payments: the first
would leave the charge behind, and the second touched three rows at once.

An order the mail sync imports is one record, though it adds the order, its
items and the inventory items they make. Its Undo removes the order and the
database takes the rest with it. The undo is refused once later mail has
added a shipment or return, or the person has given one of its things a use,
a list, a family or a task.

What the mail sync files in the job search is recorded the same way. A
company or role it adds is one record, with the application, events and
interviews the same email made under it, and its Undo removes them together.
An event it files on a pursuit that was already there is a record of its own,
and so is a round it books, an invite that moves or cancels an interview, a
contact it adds or gives an address, and a domain, job board or title it
teaches a company or role. An application's status is worked out from its
events, so undoing an event puts the status back too. An add is refused once
anything has been written under it since, whether by the person or by later
mail.

A **Dash today** panel lists what Dash did today, grouped by workspace, each
with its Undo, and what is running now. Home shows its count. The runs in
progress (`goals.runs`, `plan_runs` and hand-offs in flight) are what set
`dash_working` on a row.

Claude Code routines write to the database through the Supabase connector, not
through the app's code. They record their writes here by following their
skill's instructions, which is a convention, not something the database
enforces. A database function, `core.record_dash_action`, keeps that to one
call, and the skills that write rows (goals, dash-backup, notes, plan) are
updated to use it.

## Part 6: One Dash

`lib/dash/` holds one loop, grown from `lib/talk/ask.ts`, and one tool
registry. Every surface calls the same loop with a context: which surface, the
subject ref and its thread if there is one, and the page the person is on.

**Reading.** The 15 lookup tools Ask has today, available on every surface. A
reply on a role thread can look up the person's todos, and a reply on a goal
can read the job search.

**Writing.** One registry of write tools, each declared by its workspace with
the same shape: a name, an input schema, an apply function that returns the
subject ref and the before and after values, and an undo. It holds everything
the separate paths can do now: the four proposals, the six dev comment actions,
the five capture moves, the cover letter, and goal facts. To those it adds the
writes #1440 lists: a new goal, editing and rescheduling a todo, and closing a
todo or step. Each write goes through Part 5.

A write happens straight away and carries an Undo, which is how #1439 was
answered on 2 October 2026. Anything that acts outside the app, such as
sending an email or buying something, is always a proposal. Anything no tool
can do goes to the hand-off routine (#1402).

**Reach.** `list_rows` (`lib/ask/list-rows.ts`) reads any table in the sources
catalogue that is tied to its owner by a column, newest first, so a table is
readable by Dash the day its module declares it. `tests/ask-reach.test.ts`
fails a source Dash cannot list unless it says why. Before it, a table no
lookup was written for was invisible: on 7 October 2026 Dash told the person
it had no way to pick a YouTube video, with 122 on their watch list.

**Refusing.** The `answer` tool takes `could_not`, a sentence for what the
person asked that Dash did not do. An answer that sets it before any lookup
is sent back once with `LOOK_FIRST` (`lib/dash/loop.ts`). In Ask, a
`could_not` that stands is filed as a feature note on `/dev/bugs`, naming
what was missing and quoting the question, so the gap is built rather than
met again. Deleting, sending and spending are the only requests Ask turns
down; anything else is looked up, done with a tool, or handed on.

**Model.** One file, `lib/dash/models.ts`, names the model per surface: Sonnet
for Ask and threads, Haiku for capture, where speed matters more than reach.
The other model constants in the app move to `lib/core/models.ts` in the same
change, so a model is updated in one place.

**Memory.** Every surface gets `recall` over `core.memory_chunks`. The person's
turns in threads and Ask become a memory source, so that what they said to
Dash on a role page can be recalled from Ask a week later.

**Limits.** The time budget is set to fit the route's `maxDuration`, and the
lookups stream to the page as they run, which are #1437 and #1438 and are built
first.

**Maya** is the second decision below.

The Dash connector for claude.ai already reads its tools from Ask's registry,
and reads them from the new one. Scheduled writers that are not conversations,
such as the morning brief, the week review and Learn's card writer, stay as
they are; any change they make to the person's rows goes through Part 5.

## Rules

Written in the form [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) describes. Each
count is measured by a counter in `scripts/spec-counts.ts`, and
`npm run check:specs -- --list` prints what it counted. The baselines were
measured on main on 3 October 2026, and three differ from the estimates under
**What there is today**: `job_search.attachments` is a fourth link table with
a column per target, the Learn now card and Quick read discussions are two
more conversational paths, and 74 files hold a model id.

**R1.** Every comment thread is stored in `core.conversations`, with its
turns in `core.conversation_turns`.
Checked by: count `thread-tables`, baseline 6, target 1.

**R2.** Every place the person talks to Dash runs on the one loop in
`lib/dash/`.
Checked by: count `conversational-model-paths`, baseline 8, target 1.

**R3.** A model id is written in one file, `lib/core/models.ts`.
Checked by: count `model-id-files`, baseline 74, target 1.

**R4.** A row points at another row by a ref, not by a column for each kind
of row it could point at.
Checked by: count `link-tables-per-target-column`, baseline 4, target 0.

**R5.** Every write Dash makes to the person's rows has a `core.dash_actions`
row that can undo it.
Checked by: test `tests/dash-actions-recorded.test.ts`, pending #1459.

**R6.** Every skill that writes the person's rows records each write with
`core.record_dash_action`.
Checked by: test `tests/skills-record-dash-actions.test.ts`.

The counters count these things:

- `thread-tables`: tables whose rows are turns between the person and Dash or
  Maya, told apart by an author or role column checked to one of each, such
  as `author in ('me', 'claude')`. `core.memory_chunks` marks its rows the
  same way and is left out, because it copies turns out of the threads to
  search them. So is a table whose threads were copied into the shared store
  and which now refuses writes through `core.refuse_thread_writes` (plan
  #1470), kept until the person says it can go.
- `conversational-model-paths`: spend operations under which a model answers
  what the person typed, which are the ones named `ask-`, `reply-` or
  `discuss-`, and capture's `file-capture`.
- `model-id-files`: files under `app`, `components`, `inngest`, `lib` and
  `scripts`, tests aside, that contain a model id such as `'claude-sonnet-5'`.
- `link-tables-per-target-column`: tables with a check that exactly one of
  three or more `_id` columns is set.

## Contract

Rules: R1, R2, R3, R4.

Written by the design session (#1518), with job roles as the workspace moved
across. Each file below is the one place its piece is defined; a later step
that needs the piece uses it rather than writing a second copy.

Refs (Part 1):

- `lib/core/refs.ts`: parsing a ref, the page it opens and the titles of a
  batch of refs, read from the sources catalogue.
- `lib/sources/catalogue.ts`: every table with a page, its href and how its
  title is read; the registry `lib/core/refs.ts` reads.
- `supabase/migrations/0156_ref_owned.sql`: the database check that a ref
  written into a row names a row of the same account.

Threads (Part 2):

- `supabase/migrations/0167_thread_turns.sql`: `core.add_thread_turn`, which
  writes a turn under any ref, and `core.thread_turns`, which reads them.
- `lib/thread/store.ts`: the app's reads and writes of a row's thread, and
  `threadCause`, the comment a reply's writes are recorded under.
- `lib/thread/subjects.ts`: which rows have a thread, and the ref for each.
- `components/thread/thread.tsx`: `<Thread subject={ref} />`, the one thread
  component, with `@dash` recognised.

Whose move (Part 3):

- `lib/core/move.ts`: the five states, their words, and `withRun`, which
  marks a row Dash is working on.
- `components/ui/move-label.tsx`: the one label that draws a move.
- `lib/jobs/move.ts`: the move of a job application, as the example of a
  workspace's own move function.

The record of what Dash did (Part 5):

- `supabase/migrations/0161_dash_actions.sql`: `core.dash_actions`, one row
  per write Dash makes, with the row before and after.
- `supabase/migrations/0163_record_dash_action.sql`:
  `core.record_dash_action`, the one call a routine records a write with.
- `lib/core/dash-actions.ts`: recording a write from the app, and the one
  undo rule.
- `lib/talk/changes.ts`: keeping a registry write's record, from Ask or
  from a thread under the comment that asked for it.
- `lib/shell/dash-today.ts` and `app/home/dash-today.tsx`: what Dash did
  today, by workspace, with Undo and, for a thread's write, a link to the
  row whose thread asked for it.

One Dash (Part 6):

- `lib/dash/loop.ts`: the one loop every surface runs.
- `lib/dash/registry.ts`: the one tool registry, with the tools each surface
  is offered.
- `lib/dash/writes.ts`: the registry's write tools, each with its apply and
  undo.
- `lib/dash/thread.ts`: a thread's reply through the loop, recording each
  write under the comment it answers.
- `lib/dash/thread-tools.ts`: the tools that act on a thread's own row, such
  as the role's cover letter.
- `lib/dash/models.ts` and `lib/core/models.ts`: the model per surface, and
  every other model id.

The workspace moved across:

- `lib/jobs/role-thread/ask.ts`: Dash's reply on a role, on the loop, with
  its writes recorded under the comment.
- `tests/flows/role-thread-dash.test.ts`: the flow the later phases keep
  passing, from an `@dash` comment on a role to a todo undone from Home.

## Design log

- 2026-10-03 (#1518): Job roles were already on the shared pieces on main
  when the design session began: the thread in `core.conversations` (#1470),
  the loop (#1465), the move label (#1454) and Dash today (#1461). The
  session added what was missing instead of building them again.
- 2026-10-03 (#1518): A thread's write is recorded with `conversation_id` as
  the row's thread and `turn_id` as the person's comment, so Home can link a
  todo to the role it came from. The columns and their foreign keys were
  already there, so there is no migration.
- 2026-10-03 (#1518): Only the role's reply passes its comment so far. Dev
  rows, goals and the generic thread reply still record their writes with no
  comment until phase 2 moves each of them, which is one argument to
  `replyInThread`.
- 2026-10-03 (#1518): The role's reply keeps its own spend operation,
  `reply-to-role-comment`. Folding it into another would split its spend
  history before anyone has decided what the one operation for R2 is called,
  so that waits for R2's removal step.
- 2026-10-03 (#1518): `job_search.notes` and `job_search.attachments` keep
  their column per target (R4). The live database is shared with main, so
  those columns cannot go on a branch; they are phase 3 work. The role's
  notes stay notes, as Part 2 says.
- 2026-10-03 (#1518): The flow test runs the code over in-memory tables and
  checks the record it writes against the local database separately. The app
  reaches the database through PostgREST, and the test database has none.

## Decisions

**1. What happens to the threads already written?**

- A. Copy them into `core.conversations` and switch every reader to it. The old
  tables become read-only, and are removed after 30 days on your say-so. Cost:
  one data move, checked by counting rows before and after.
- B. Leave them where they are and write only new threads to the shared store;
  the thread component reads both. Cost: two places to read, permanently, and
  every thread feature built twice.

Recommendation: A. There are a few hundred rows, and B keeps the problem this
spec exists to remove.

**Decided 2 October 2026: A.** The old tables are removed only when the person
says so, after the 30 days.

**2. Does Maya become one of Dash's voices?**

- A. Maya runs on the same loop, store and ledger, as a voice Dash takes in the
  vault, keeping its model (Opus), its web search and its tone. Cost: its
  retrieval over vault positions becomes one of Dash's lookup tools.
- B. Maya stays separate, with its own threads and code. Cost: a sixth thread
  store and a second assistant to keep working.

Recommendation: A. What Maya does differently is its tone and its model, and
both can be settings of a voice. Moved onto the loop, its threads become
searchable and its retrieval becomes available to Dash everywhere.

**Decided 2 October 2026: A.**

## Order of work

Each part is a feature on the plan, built in this order. Three already
proposed features become parts of this spec if it is approved.

1. **Ask Dash reliability**, #1437 and #1438, built first and on their own, since
   they fix failures the person is seeing now.
2. **Refs** (Part 1). Everything else depends on it.
3. **Move vocabulary** (Part 3). This absorbs #1433.
4. **The ledger and Dash today** (Part 5).
5. **The loop and tool registry** (Part 6), with Ask moved onto it first, then
   the write tools. This absorbs #1440.
6. **Threads** (Part 2), moving dev, goals, files and roles onto the shared
   store and component, then adding threads to the workspaces that have none.
   This absorbs #1441.
7. **The "on you" list and Waiting view** (Part 4).
8. **Capture and Maya** onto the loop.

[CUT-BACK-SPEC.md](CUT-BACK-SPEC.md) runs alongside this. Cutting Learn and
Jobs down first means fewer pages to move onto the shared thread and move
label.

## Costs and risks

Refs have no foreign keys, so a deleted row leaves its thread and ledger rows
behind. They are hidden when read, and the cost is some unused rows.

The routines' writes to the ledger depend on their skills being followed, and a
skill that forgets leaves an action with no Undo. The gate can check that every
skill writing to the person's tables mentions `core.record_dash_action`, which
catches the common case.

Moving dev and goal comment replies from Haiku to Sonnet raises their cost per
reply. Ask Dash averaged about 1.3 cents per call over the last 30 days, so a
hundred thread replies a month cost about a dollar more.

The thread move in decision 1 is the one step here that rewrites existing
data. It runs as a copy first, with the counts compared, before any reader
switches over.

## What this does not do

It does not change what any workspace stores about its own rows, merge the
workspaces' schemas, or give Dash access to anything outside the app beyond
what it has now.
