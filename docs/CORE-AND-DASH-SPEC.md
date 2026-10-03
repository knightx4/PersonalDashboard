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
and `news_story` threads become `row` threads under their refs.

One component, `<Thread subject={ref} />`, shows a thread, takes a new comment,
recognises `@dash`, and shows Dash's reply when it lands. It replaces the
thread on plan rows, ideas, raises, goal steps, files and roles, and adds one
to todo tasks, orders, inventory items, news stories and vault notes. The
role's notes stay as notes; only the conversation with Dash moves.

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
