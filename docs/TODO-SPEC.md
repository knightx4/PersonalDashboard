# Todo

A fourth workspace: the things you have to do, across all three of the others
and outside all of them.

It is specified in full here because the interesting part is not the todo list —
that is a table with a title and a due date, and it is an afternoon — but the
integration, and the integration is where every todo app that has ever been
bolted onto something else has gone wrong. The shape of v1 is chosen to make
the integration honest rather than to make v1 impressive.

## Why a todo module at all

Three workspaces already generate obligations, and each of them holds its own
in its own way:

- **Job search** has `job_search.reminders` — follow-ups, prep, thank-yous,
  deadlines — some rule-generated and idempotent on `rule_key`, some typed by
  hand. `/jobs/today` reads them.
- **Shopping** has `orders.return_deadline`, derived by `sync_order_state()`
  from the delivery date and the merchant's window, and `saved_items.cooldown_until`.
- **Vault** has whatever you wrote in Obsidian, including every `- [ ]` you have
  ever left in a daily note.

None of those is wrong. Each is the right home for the fact it holds. What is
missing is the question none of them can answer, because each can only see its
own third of it: **what do I have to do today.** And a fourth category has no
home at all — "renew the passport", "call the landlord" — which is most of what
a person actually needs a list for.

So the module exists for two reasons and it should be judged on both: it holds
the todos that belong to no workspace, and it is the one page that merges the
obligations that do.

### What it is authoritative for

**Only the todos you typed here.** Nothing else.

It is not authoritative for whether a follow-up is due (the job side's rules
are), not for when a return window closes (`sync_order_state()` is), and above
all not for the state of a checkbox in a note (Obsidian is, and always will be).

This is the whole design, so it is worth stating as a sentence you could hang on
a wall: **the todo module owns the tasks you typed into it, and for everything
else it owns nothing but the decision to stop showing it to you.**

## The rule this module is built to obey

The obvious build is a `tasks` table with a `source` column, into which the job
reminders, the return deadlines and the note checkboxes are all imported on a
schedule. Every product that has tried this has produced the same three bugs,
and they are not implementation bugs:

1. **Two writers.** The row exists twice, the copies drift, and the answer to
   "which one is right" depends on which page you are looking at.
2. **Resurrection.** The upstream row is deleted; the copy is not; a task you
   have no way to satisfy sits on the list forever.
3. **A write-back that cannot happen.** You tick the checkbox that came from a
   note, and the app must now either write to your vault — which
   [VAULT-SPEC.md](VAULT-SPEC.md) forbids in its second sentence — or lie.

So the rule: **an obligation is displayed by whoever needs to show it and
written by whoever owns it.** The todo module reads the other three at query
time and never copies a row out of them. What it stores about a foreign
obligation is one thing only: that you dismissed or deferred it.

That is not a new pattern here. `job_search.waiting_dismissals` and
`quiet_dismissals` (migration `0036_today_dismissals.sql`) already do exactly
this for the two sections of `/jobs/today` that are recomputed on every load:
a row means "do not show me this one again", and `dismissed_until` being null is
the difference between "Done" and "Later". This module generalises that table
and nothing more.

The cost is real and is accepted: **the merged list cannot be sorted or
paginated by the database.** It is assembled in TypeScript from four queries.
That is affordable because the agenda is bounded by a horizon rather than by a
page size — a fortnight of obligations is tens of rows, not thousands — and it
is made testable by keeping the merge a pure function (`lib/todo/agenda/merge.ts`),
the same way `lib/vault/sync/plan.ts` keeps every decision in a sync away from
the I/O that performs it.

## Non-goals

Listing these because they will otherwise get invented.

- **Not a project manager.** No projects, no boards, no assignees, no
  dependencies, no subtasks. One account, one person.
- **No priority field.** A P1/P2/P3 column is a decoration that becomes noise
  within a week: everything is P1 by March. The ordering is the due date, and
  `pinned` (which `job_search.notes` already uses) is the one manual override.
- **No recurrence in v1.** A weekly review is a real need and RRULE with
  exceptions is a real project. See "What this unlocks".
- **No writing to the vault, ever.** Not a `- [x]`, not a new note, not an
  `outbox/` folder. If app-authored notes ever happen, that is the vault's
  decision to make, in its own spec, and not a side effect of a todo list.
- **No notifications, email or push, in v1.** The daily cron already exists and
  the agenda already exists; deciding to interrupt someone is a separate
  decision with its own failure mode.
- **No natural-language date parsing in v1** ("next tuesday"). A date field is
  not the friction anyone actually complains about.
- **No LLM anywhere in this module in v1.** Nothing here needs one.
- **Not a replacement for `/jobs/today`.** See below; the duplication is
  deliberate and bounded.

## The four sources, and who owns each

| On the agenda | Owner | The app writes | Completing it |
|---|---|---|---|
| A todo you typed | `todo.tasks` | everything | writes `todo.tasks.status` |
| A job reminder | `job_search.reminders` | nothing new | writes `completed_at` on the job row |
| A return deadline | `public.orders` (derived) | nothing | dismissal only — the deadline is a fact, not a task |
| A note checkbox | your vault | **nothing** | dismissal, or promotion into a task of your own |

The second row is the one exception to "never write to another schema", and it
is not really an exception: `/jobs/today` and `/todo` are two views of one row,
there is no second copy, and marking a follow-up done from either place does the
same single `update`. One writer, two windows onto it.

## Schema

A fifth schema, `todo`, alongside `public` (shopping), `job_search`, `obsidian`
(the vault) and `core` (ingestion).

The name was checked against what Supabase ships on every project before it was
chosen — that is the lesson of `obsidian`, which is called that because `vault`
was already taken by Supabase Vault and creating tables there would have
published the secrets store. `todo` collides with nothing.

**Why its own schema and not `core`.** `core` is for facts that arrive on a
shared sync and that no workspace owns — an order confirmation and a rejection
letter pulled from the same mailbox. A todo is not ingested, it is authored, and
it has exactly one consumer. Same argument the vault made, same answer.

**Why not `public`.** `public` is the commerce side's schema. A todo about a
passport renewal is not a commerce fact, and putting it there would make
"shopping owns this" true in the database and false in the product.

Migrations live in `supabase/migrations-todo/`, applied last by
`scripts/db-reset.sh` — after `migrations`, `migrations-job-search` and
`migrations-vault`, because the foreign keys below point into all three.

### `todo.tasks`

```sql
create type todo.task_status as enum ('open', 'done', 'dropped');
create type todo.task_source as enum ('manual', 'note');

create table todo.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  -- Optional detail, markdown, rendered by the same component the vault uses.
  body text,

  status todo.task_status not null default 'open',
  -- Set together with status by the app; kept as columns rather than derived
  -- because "when did I finish this" is a fact the enum cannot hold.
  completed_at timestamptz,
  dropped_at timestamptz,

  -- A due DATE and a due INSTANT are different things and the difference shows.
  -- "Tuesday" is a date: it must not move because you flew to Lisbon. A prep
  -- task pinned to an interview at 14:00 is an instant and must move. At most
  -- one is set; neither means someday.
  due_on date,
  due_at timestamptz,

  pinned boolean not null default false,
  -- The "Later" half, exactly as the dismissal tables use it.
  snoozed_until timestamptz,

  source todo.task_source not null default 'manual',
  -- Only for source = 'note': the checkbox this was promoted from, so the note
  -- lane can suppress a line you have already taken responsibility for. See
  -- "Checkbox identity" below.
  source_key text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_ck check (title <> '' and length(title) <= 500),
  constraint tasks_one_due_ck check (num_nonnulls(due_on, due_at) <= 1),
  constraint tasks_completed_ck check (
    (status = 'done') = (completed_at is not null)
    and (status = 'dropped') = (dropped_at is not null)
  ),
  constraint tasks_source_key_ck check ((source = 'note') = (source_key is not null))
);

-- Two indexes rather than one over `coalesce(due_on, due_at::date)`, which
-- Postgres rejects outright: timestamptz -> date depends on the session's
-- TimeZone and so is not immutable, and an index expression must be. Which is
-- the same fact that made the two columns necessary in the first place, saying
-- itself twice.
create index tasks_user_due_on_idx on todo.tasks (user_id, due_on)
  where status = 'open' and due_on is not null;
create index tasks_user_due_at_idx on todo.tasks (user_id, due_at)
  where status = 'open' and due_at is not null;
create index tasks_user_status_idx on todo.tasks (user_id, status, created_at desc);
-- Promotion is idempotent: promoting the same checkbox twice is one task.
create unique index tasks_source_key on todo.tasks (user_id, source_key)
  where source_key is not null;
```

`status` is a real column and not derived, unlike order status. There is no
`sync_task_state()` to own it, because nothing about a todo is computed from
anything else — you said it was done, and that is the entire rule.

### `todo.task_links`

What the task is about. Real foreign keys, into four schemas, because they are
all in one database and a cross-schema foreign key costs nothing and buys the
cascade for free: delete the role and its tasks' links go with it.

```sql
create type todo.link_relation as enum ('about', 'source');

create table todo.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references todo.tasks (id) on delete cascade,
  relation todo.link_relation not null default 'about',

  application_id uuid references job_search.applications (id) on delete cascade,
  role_id        uuid references job_search.roles (id) on delete cascade,
  company_id     uuid references job_search.companies (id) on delete cascade,
  contact_id     uuid references job_search.contacts (id) on delete cascade,
  interview_id   uuid references job_search.interviews (id) on delete cascade,
  note_id        uuid references obsidian.notes (id) on delete cascade,

  created_at timestamptz not null default now(),

  constraint task_links_exactly_one_ck check (
    num_nonnulls(application_id, role_id, company_id, contact_id, interview_id, note_id) = 1
  )
);

-- At most one 'about' per task: a task is about one thing. It may cite several.
create unique index task_links_about_key on todo.task_links (task_id)
  where relation = 'about';
```

The "exactly one parent from N" shape is lifted straight from `job_search.notes`,
which takes one parent from five, and adding a seventh target later is one
column and one edited check constraint.

`relation` distinguishes *what this is about* from *where it came from*: a task
promoted out of a note is `source` → that note, and may separately be `about`
the role you were writing about. Both are useful and they are not the same edge.

**The one thing to watch.** These foreign keys make the todo migrations depend
on the other three sets having been applied first. `db-reset.sh` already
sequences the directories explicitly and `migrations-todo` goes on the end;
a fresh Supabase project must be migrated in the same order, which
[SETUP.md](SETUP.md) will say.

Every statement in this section was applied to a Postgres 16 before it was
written down, including the constraint behaviour (a `done` with no
`completed_at` is refused, a task with both a `due_on` and a `due_at` is
refused, a second `about` link is refused) and the cross-schema cascade
(deleting a role removes its link and leaves the task). The sketches are
starting points for the migration, not the migration.

### `todo.dismissals`

The overlay, and the only thing this module stores about an obligation it does
not own.

```sql
create type todo.foreign_source as enum ('job_reminder', 'return_deadline', 'note_checkbox');

create table todo.dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source todo.foreign_source not null,
  -- Stable identity WITHIN that source. Not a foreign key: see below.
  source_key text not null,
  -- Null means "for good". Set means "Later", same distinction the reminders
  -- table draws with due_at vs completed_at.
  dismissed_until timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_key)
);
```

**Why a text key here when links get real foreign keys.** Because links point at
*rows* and dismissals point at *observations*. A return deadline is a column on
an order, not a row; a note checkbox is a line in a file and is not a row
anywhere at all. An observation has no id to borrow, so it gets a derived one.

Key derivation, one line each and none of it clever:

- `job_reminder` — the reminder's uuid. (A row, but it is dismissed rather than
  completed when you mean "not this one, not now", and completion is a write on
  the job side. Both paths exist.)
- `return_deadline` — the order's uuid.
- `note_checkbox` — see below.

### Checkbox identity

The hard one, because the thing being identified is a line of text that moves.

```
key = `${note_id}#${ordinal}:${sha256(normalized)[0..12]}`
```

`normalized` is the line with the `- [ ]` marker, leading whitespace and
trailing whitespace stripped and internal whitespace collapsed. `ordinal` is the
index among lines in that note with the *same* normalized text, so a note with
three identical `- [ ] water the plants` lines yields three distinguishable
tasks rather than one.

The consequence, which is a feature: **editing the text of a checkbox retires
the dismissal.** The key changes, the old dismissal no longer matches anything,
and the task comes back. That is correct — you rewrote it, so it is a different
task, and a rewrite is the most common way a person signals that something has
changed. Moving a line within a note does *not* change its key, which is the
common case and must not resurface anything.

Line numbers were the obvious alternative and are wrong for exactly that reason:
inserting a paragraph at the top of a daily note would resurrect every dismissed
task below it.

### The one change to another schema

Finding notes with open checkboxes must not mean scanning every note body on
every page load. One generated column on `obsidian.notes` and one partial index:

```sql
alter table obsidian.notes
  add column has_open_tasks boolean
  generated always as (body ~ '(?n)^[ \t]*[-*+] \[ \]') stored;

create index notes_open_tasks_idx on obsidian.notes (user_id, git_updated_at desc)
  where has_open_tasks and deleted_at is null;
```

`(?n)` is Postgres's newline-sensitive flag, so `^` matches at each line rather
than only at the start of the body. (Verified against Postgres 16, including in
a stored generated column, before this was written down.)

A generated column and not a table: it is derived from the mirror by the
database at write time, so there is no second writer, nothing to backfill and
nothing that can drift. The vault sync does not learn that the todo module
exists.

It lives in `supabase/migrations-vault/`, not with the todo module, because the
vault's shape is described in one place — and the vault's own viewer wants the
same filter ("notes with something outstanding in them") independently of this.

### RLS

Every table, from the first migration, `user_id = (select auth.uid())` — the
same four policies the other schemas use. `task_links` has no `user_id` of its
own and is policed through its task:

```sql
create policy task_links_all on todo.task_links for all to authenticated
  using (exists (select 1 from todo.tasks t
                 where t.id = task_links.task_id and t.user_id = (select auth.uid())))
  with check (...same...);
```

`obsidian.notes` denormalises `user_id` and defends it with a trigger because
its list query is the hottest read in that workspace. `task_links` is never
read without its task, so it does not need the same trick and does not get it.

`tests/rls-todo.test.ts` and `tests/helpers/db-todo.ts` land in the same commit
as the migration, before any feature code, the way `tests/rls.test.ts` did.
`todo` also joins the exposed-schemas list in `lib/core/db/schema-errors.ts` and
its test — a schema missing from Settings → API → Exposed schemas fails every
query with PGRST106, and that has already cost this project a debugging session
once.

## Integration: the job tracker

**Reading.** The agenda shows reminders that are due within the horizon and not
completed, exactly as `loadToday` selects them today, and it carries across the
one affordance that makes them work: `lib/jobs/followup/compose.ts` and the
Gmail compose URL. Commit `fd33268` — *write the follow-up, not just the
reminder to send one* — applies with full force here. A merged agenda that
degrades a follow-up reminder into a line of text with a checkbox is a
downgrade, not an integration.

**Completing.** Writes `completed_at` on `job_search.reminders` through a jobs
client. One row, two views.

**Interviews are not tasks.** They are appointments; you do not tick them off.
They appear on the agenda as *day context* — a line at the top of the day saying
what is already in it — and never as items with a checkbox. `/jobs/today` keeps
showing them as a section of its own, which is right there and would be wrong
here.

**Writing back the other way.** A task can be `about` an application, role,
company, contact or interview, and those pages grow a small Tasks section that
lists open tasks linked to them and can add one. This is the integration that
actually gets used: you are looking at a role, you think of something, and you
should not have to change workspaces to write it down.

**Does `job_search.reminders` eventually go away?** Partly, and not now. The
rule-generation machinery — idempotent on `rule_key`, cascading with the
application — belongs to the job side and should stay there. If, after the todo
module has run for a while, every *hand-typed* job reminder turns out to be
created in `/todo` instead, then `reminders` narrows to rule-generated rows only
and the "custom" kind is retired. That is a migration to write when the usage
says so, not a thing to assume.

**And `/jobs/today`?** Stays. It answers "what does the job search need", which
is the question you have when you are working the pipeline for an hour. `/todo`
answers "what do I have to do today", which is the question you have at 9am. The
same three reminders appear on both, and that is the correct amount of
duplication for two pages asking genuinely different questions. Collapse them
only if the job-specific sections (going quiet, waiting on you) end up making
sense on a general agenda — which is doubtful, because they are pipeline
diagnostics rather than obligations.

## Integration: vault notes

Two directions, and the read-only direction is the one that needs the care.

**Notes as anchors.** A task can be `about` a note, and a note's page in the
viewer grows the same small Tasks section a role page gets. No new machinery —
`obsidian.notes.id` is stable across a delete and a restore precisely so that
citations survive a bad afternoon, and a task link is a citation.

**Checkboxes as an agenda lane.** Notes with `has_open_tasks` are read, their
bodies parsed for `- [ ]` lines by `lib/todo/notes/checkboxes.ts` (pure, tested
against real Obsidian syntax — nested lists, indentation, `* [ ]`, a checkbox
inside a callout, `[ ]` in a code fence, which is not a task), and each line
becomes an agenda entry keyed as above.

They appear in **their own lane**, visually distinct, labelled by their note,
and they are **read-only**. There is no checkbox to tick, because ticking it
would either write to the vault or lie about having done so. What there is:

- **Open the note** — the viewer, scrolled to the line.
- **Later** — a `dismissed_until` dismissal. It comes back after.
- **Not here** — a permanent dismissal. It stays in your vault; it stops being
  on this page.
- **Make it mine** — promotion: creates a real `todo.tasks` row with
  `source = 'note'`, `source_key` set to the checkbox key and a `source` link to
  the note. The lane then suppresses that line while the promoted task is open,
  so it appears exactly once.

Promotion is the interesting one, and it is the same move the evidence layer
makes: **confirmation at the point of use.** The vault never hands you a queue
to triage — [VAULT-SPEC.md](VAULT-SPEC.md) is explicit about that and this
module must not become one by the back door. Taking responsibility for a line
is a thing you do when you were already looking at it, once, and it costs one
click.

Which is also why the lane has a hard cap and a horizon: the newest N notes with
open checkboxes, not all of them. A vault with four hundred stale `- [ ]` lines
in daily notes from 2023 must not turn the agenda into a review queue. If the
cap is regularly hit the answer is a filter you choose (a folder, a tag), not a
longer list.

**Which is the master.** Obsidian, always. If the note's line becomes `- [x]`
upstream, it leaves the lane on the next sync with no action here. If a promoted
task's note line is ticked upstream, the promoted task does **not** auto-complete
— it is your task now, in your list, and the app does not close things you did
not close. Its card says the note's line is now ticked, and closing it is one
click. Guessing here is how a todo app silently loses a task.

## Integration: shopping

Smallest of the three, deliberately.

`orders.return_deadline` within the horizon, for orders not already returned,
appear as their own lane with the same dismissal overlay and a link to the
order. They are not tasks and cannot be completed — the deadline stops
mattering when the return exists or the date passes, and both of those are facts
the shopping side already derives.

`saved_items.cooldown_until` is Phase 2 on the shopping side and waits for it.

## Surfaces

**A fourth workspace**, in the switcher, with `/todo` as its home. The switcher's
model is "which of these am I in", and a merged agenda is genuinely one of them
rather than a page inside any other.

- `/todo` — the agenda. Overdue, today, this week, then Someday collapsed.
  Lanes for the three foreign sources, inline in each day, visually secondary to
  the tasks you own. An empty agenda says so and is not padded out to look busy;
  `/jobs/today` already sets that tone and it is right.
- `/todo/all` — everything, including done and dropped, filterable by link and
  by status. The archive you consult, kept off the page you use daily.
- `/todo/settings` — the horizon, and a switch per lane. Someone who does not
  want their notes on this page should be able to say so once.

Inline, in the other workspaces: a Tasks section on the role, company, contact
and interview pages, and on a note. Small, list plus one input, no page of its
own.

**On `/home`**, the top slice of the agenda — the two or three things due today —
under the workspace tiles. That page currently shows two counts and no reason to
visit it; this is the reason.

## The agenda merge

```
lib/todo/
  agenda/
    load.ts        four queries, in parallel, one client per schema
    merge.ts       PURE. lanes, ordering, dismissal application, dedupe
    merge.test.ts
  notes/
    checkboxes.ts  parse `- [ ]` out of a note body. PURE.
    checkboxes.test.ts
  tasks/
    load.ts        list, filter
    write.ts       create, edit, complete, drop, snooze, promote
  links/
    load.ts        "tasks about this role", for the inline sections
  db/
    schema-name.ts TODO_SCHEMA + the typed client, as the vault has
  auth/
    server.ts      a Supabase client bound to `todo`, anon key, RLS applies
```

`merge.ts` takes already-fetched lists, the dismissal rows and an explicit
`now`, and returns the lanes. No client, no clock of its own, no I/O. Everything
that could be wrong about an agenda — a snooze that has expired, a promoted
task double-appearing, an overdue item sorting after a future one, a dismissal
that should have lapsed because the text changed — is a table test in
`merge.test.ts` and needs no database. This is the shape `lib/vault/sync/plan.ts`
uses and the reason that sync's decisions are testable at all.

`load.ts` needs four supabase clients, one per schema, because a client is bound
to one schema. `app/home/page.tsx` already creates two side by side; this is the
same thing with two more. They run in one `Promise.all`, and a lane that fails
degrades to empty with the failure surfaced rather than taking the page down —
your own todos must render when the vault's token has expired.

## Rules

Candidates for the README's Rules section once this ships, because they are the
ones that will otherwise be violated by a well-meaning later commit.

- **The todo module never copies a row out of another schema.** A foreign
  obligation is read at query time; the only thing stored about it is a
  dismissal. A `source_key` on a promoted task is a key, not a copy — the title
  is yours from the moment you promote it, and nothing syncs it back.
- **Nothing in this module writes to the vault.** Enforced by the existing
  boundary: the vault's provider interface is read-only and lint already stops
  anything outside `lib/vault/providers/` from reaching git at all.
- **A task about something is a foreign key**, not a text field holding a name.
  If the role is deleted the link goes with it.
- **The agenda merge is pure and takes its clock as an argument.** A function
  that calls `Date.now()` inside the merge cannot be tested for "overdue" and
  will not be.
- **Completing a job reminder writes to `job_search.reminders`.** There is no
  second copy of that row and there must never be one.

## Build order

Each step is shippable on its own, and the module is useful after step 2.

1. **Schema, RLS, isolation test.** `supabase/migrations-todo/0001_todo_schema.sql`,
   `tests/rls-todo.test.ts`, `tests/helpers/db-todo.ts`, `todo` added to
   `db-reset.sh` and to the exposed-schemas assertion. No feature code. This is
   step 2 of the original build order repeating itself for a reason: a missing
   policy fails now rather than in six months.
2. **The list you typed.** `/todo`, `/todo/all`, create, edit, complete, drop,
   snooze, due dates, pinned. Workspace switcher entry. Zero integration —
   and already worth having.
3. **Links and the inline sections.** `task_links`, the Tasks section on role,
   company, contact and interview pages and on a note. Tasks on the agenda group
   under what they are about.
4. **The job lane.** Reminders on the agenda with the follow-up composer intact,
   completion writing through to `job_search`, interviews as day context,
   dismissals.
5. **The note lane.** The generated column on `obsidian.notes`,
   `checkboxes.ts`, the read-only lane, and promotion.
6. **The shopping lane.** Return deadlines. Half a day; last because it is the
   thinnest.
7. **`/home`.** The top slice of the agenda on the front door.

## Open questions

- **Does the note lane earn its place?** It is the most interesting integration
  and the most likely to be noise. If, after a month, the lane is dismissed more
  often than it is promoted, it should default to off. Instrumenting that is one
  count against `todo.dismissals` and worth doing at step 5.
- **Timezone.** `profiles.timezone` exists and `lib/jobs/timezone.ts` already
  does this work for interviews. "Today" on the agenda must use it, and the
  `due_on` / `due_at` split above is what makes that possible rather than
  approximate. Reuse rather than reimplement, and if that means the helper moves
  out of `lib/jobs/`, move it.
- **The horizon.** `/jobs/today` uses 14 days for interviews and 7 for
  reminders. The agenda probably wants 7 with everything beyond it collapsed
  into "later", but that is a number to set after looking at a real week, not
  before.
- **Ordering within a day.** Due time, then pinned, then created? Or a manual
  drag order, which means a `position` column and the fractional-index problem?
  v1 sorts and does not drag. Revisit only if it actually grates.

## What this unlocks (not v1)

Recorded so the v1 shape is legible, and so none of it gets built early.

- **Recurrence**, which is the first thing anyone will ask for. It wants
  `todo.task_recurrences` and a generator, not a column, and it should not be
  bolted onto `tasks` in a hurry.
- **Rules that raise a todo**, the way the job side already raises a reminder:
  an item unused for six months, a return window closing on something you have
  not opened. The dismissal table is already the right shape for the ones you do
  not want, and `rule_key` is already the right shape for idempotence — copy it.
- **The vault as the source of intent.** [VAULT-SPEC.md](VAULT-SPEC.md) argues
  the vault is authoritative for what you *want*, where both other schemas only
  know what happened. A todo list is the first place a preference becomes an
  action, and the first honest consumer of a vault passage that is not a draft.
- **Notifications**, once there is a day's agenda worth interrupting someone
  for. The cron exists. The judgment about when a person wants to be interrupted
  does not, and inventing it is the whole task.
