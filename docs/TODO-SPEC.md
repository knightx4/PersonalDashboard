# Todo

A fourth workspace: the things you have to do, across all three of the others
and outside all of them.

> **Built**, as build order steps 24–31. What this document got wrong on
> contact with the code is recorded at the end, under "What changed in the
> building". Everything else here still describes what is there.

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
  ever left in a daily note. (Reading those is explicitly *not* in v1 — see
  "Integration: vault notes". It is listed here because it is the reason the
  agenda is built to take new sources without being rewritten.)

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
paginated by the database.** It is assembled in TypeScript from one query per
enabled source.
That is affordable because the agenda is bounded by a horizon rather than by a
page size — a fortnight of obligations is tens of rows, not thousands — and it
is made testable by keeping the merge a pure function (`lib/todo/agenda/merge.ts`),
the same way `lib/vault/sync/plan.ts` keeps every decision in a sync away from
the I/O that performs it.

## Sources are plug-ins, and only one of them is on

The module ships with your own tasks and nothing else. Every other source is a
switch in `/todo`'s own settings, off until you turn it on.

That is not caution for its own sake. Each source is a separate small module
behind one interface — given a window of time and a user, return the
obligations in it — registered in one list:

```ts
// lib/todo/agenda/sources.ts
export interface AgendaSource {
  id: 'job_reminders' | 'return_deadlines' | 'note_checkboxes';
  label: string;
  /** Everything this source has for the window. No I/O outside here. */
  fetch(ctx: SourceContext, window: Window): Promise<AgendaItem[]>;
  /** What "Later" and "Done" mean for this source's items. */
  defer(ctx: SourceContext, item: AgendaItem, until: Date): Promise<void>;
  complete?(ctx: SourceContext, item: AgendaItem): Promise<void>;
}
```

The agenda page knows about the interface and the list. It does not know that
Gmail, git or a return window exist. Adding a fifth source later — a calendar,
a bank, whatever the account grows next — is one file and one entry, and it
changes nothing about the page or the merge.

The three sources named in the enum above are the ones this document has
thought about. Two of them are cheap. The third is not, and the honest position
on it is [further down](#integration-vault-notes): the mechanism is
deliberately not chosen yet, and the source is not built in v1.

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
- **No reading of checkboxes out of notes in v1.** The source exists in the
  registry as a name with nothing behind it, and the mechanism is deliberately
  unchosen. See "Integration: vault notes".
- **Turning a module off never deletes anything.** It is a display setting: the
  workspace disappears from the switcher and its source stops appearing on the
  agenda. Nothing is dropped, no link breaks, and turning it back on restores
  exactly what was there.
- **Not a replacement for `/jobs/today`.** See below; the duplication is
  deliberate and bounded.

## The sources, and who owns each

| On the agenda | Owner | The app writes | Finishing it | Deferring it |
|---|---|---|---|---|
| A todo you typed | `todo.tasks` | everything | `status` on the task | `snoozed_until` on the task |
| A job reminder | `job_search.reminders` | nothing new | `completed_at` on the job row | `due_at` on the job row, moved forward |
| A return deadline | `public.orders` (derived) | nothing | not possible -- it is a date, not a task | a row in `todo.dismissals` |
| A note checkbox | your vault | **nothing, ever** | not possible | deferred entirely; see below |

The second row is the one exception to "never write to another schema", and it
is not really an exception: `/jobs/today` and `/todo` are two views of one row,
there is no second copy, and both columns are ones the job side already owns and
already reads. Deferring a reminder moves its due date, which is what deferring
a reminder has always meant here — so the two pages agree without either of them
knowing the other exists.

The alternative was a `todo.dismissals` row for a snoozed reminder, and it was
wrong in a way worth recording: finishing a reminder would have shown up on both
pages, because that is one record, while deferring it would have shown up on
only one, because that would have been two. Hiding something in one place and
still seeing it in another is the kind of bug that makes a person stop trusting
a page.

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

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_ck check (title <> '' and length(title) <= 500),
  constraint tasks_one_due_ck check (num_nonnulls(due_on, due_at) <= 1),
  -- The database stamps these, it does not merely check them. See below.
  constraint tasks_completed_ck check (
    (status = 'done') = (completed_at is not null)
    and (status = 'dropped') = (dropped_at is not null)
  )
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
```

There is no `source` column and no key pointing at where a task came from. Both
belong to promotion — copying a checkbox out of a note — which is not in v1, and
a column carrying a deferred feature's shape is a guess about that feature made
before it was designed. It is one migration when it is real.

`status` is a real column and not derived, unlike order status. There is no
`sync_task_state()` to own it, because nothing about a todo is computed from
anything else — you said it was done, and that is the entire rule.

**The timestamps are stamped by a trigger, not by the caller.** The check
constraint above says a `done` row must have a `completed_at`; on its own that
turns "mark this done" into an error every time a caller updates the status and
forgets the timestamp, and one caller eventually will. So the database fills
them in:

```sql
create or replace function todo.stamp_task_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done'    then coalesce(new.completed_at, now()) end;
    new.dropped_at   := case when new.status = 'dropped' then coalesce(new.dropped_at,   now()) end;
  end if;
  return new;
end;
$$;

create trigger tasks_stamp_status before update of status on todo.tasks
  for each row execute function todo.stamp_task_status();
```

Reopening a finished task clears the timestamp rather than leaving a stale one,
which is why the `case` has no `else` — a null is the correct value for "not
finished", and the constraint then agrees with the status by construction. The
constraint stays anyway: a trigger is a thing that can be dropped, and the rule
it upholds should not disappear with it.

`touch_updated_at` gets its own copy in this schema, as `obsidian` has its own
copy, so nothing here depends on another schema's function surviving a
refactor.

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

`relation` distinguishes *what this is about* from *where it came from*. Only
`about` is used in v1; `source` is what a task copied out of a note will carry
when promotion exists, and it is in the enum now because adding an enum value
later is a migration and adding a use for one is not.

#### A link must point at something you own

**A foreign key is not an ownership check, and this is the one place in the
module where getting that wrong would matter.** Postgres performs referential
integrity checks bypassing row level security — that is documented behaviour and
not a quirk — so a foreign key to `job_search.roles` is satisfied by *any* role
in the table, including one belonging to another account. The policy on
`task_links` only asks who owns the *task*. Nothing above stops a link from
pointing across accounts.

So the database checks it, rather than the app remembering to. This is the same
defence `obsidian.notes` already runs, where a note's denormalised `user_id`
must equal its connection's owner (`notes_owner_matches_connection`):

```sql
create or replace function todo.task_link_target_is_owned()
returns trigger
language plpgsql
security definer
set search_path = todo, job_search, obsidian, public
as $$
declare
  owner uuid;
  task_owner uuid;
begin
  select user_id into task_owner from todo.tasks where id = new.task_id;

  select case
    when new.application_id is not null then (select user_id from job_search.applications where id = new.application_id)
    when new.role_id        is not null then (select user_id from job_search.roles        where id = new.role_id)
    when new.company_id     is not null then (select user_id from job_search.companies    where id = new.company_id)
    when new.contact_id     is not null then (select user_id from job_search.contacts     where id = new.contact_id)
    when new.interview_id   is not null then (select user_id from job_search.interviews   where id = new.interview_id)
    when new.note_id        is not null then (select user_id from obsidian.notes          where id = new.note_id)
  end into owner;

  if owner is null or task_owner is null or owner <> task_owner then
    raise exception 'a task link must point at something the task''s owner owns';
  end if;
  return new;
end;
$$;

create trigger task_links_target_is_owned
  before insert or update on todo.task_links
  for each row execute function todo.task_link_target_is_owned();

revoke all on function todo.task_link_target_is_owned() from public, anon, authenticated;
```

`security definer` because the function has to see rows the caller's policies
would hide — which is exactly why it is written narrowly, revoked from every
role that could call it directly, and pinned to a fixed `search_path`.

It costs one extra lookup per link written, and links are written when you
create or edit a task. That is not a hot path and it is not close to one.

`tests/rls-todo.test.ts` asserts this directly: user A creating a link to user
B's role must fail. A cross-user isolation test that only covers the tables with
their own `user_id` column would pass while this hole was wide open, which is
how it came to be written down as "not needed" in the first draft.

#### Foreign keys across schemas: a decision, not an accident

These keys tie `todo`, `job_search`, `obsidian` and `public` together at the
database level. That is the point — a task about a role that survives the role
being deleted is a dangling reference, and the database preventing that is worth
more than any amount of application code trying to.

The cost is one thing, and it is worth naming because the project used to be
built the other way: `job_search` lived in its own repository, and
`tests/coexistence.test.ts` still guards the property that the two halves keep
to their own schemas. These keys mean the job side could no longer be lifted out
into a separate database without dropping them first. That trade is accepted
deliberately — this is one integrated app for one person, and integration is
the entire reason the module exists.

Two things follow from it:

- Turning a module off is a **display** setting, not a database one. It hides a
  workspace and stops its source appearing on the agenda. It deletes nothing,
  breaks no link, and is reversible by turning it back on.
- `tests/coexistence.test.ts` grows an assertion listing the cross-schema
  foreign keys that are meant to exist. A new one appearing without a line in
  that test is then a failure rather than a discovery.

The practical consequence is ordering: the todo migrations run last, after the
three schemas they point into. `scripts/db-reset.sh` already sequences the
directories explicitly, and a fresh Supabase project must be migrated in the
same order, which [SETUP.md](SETUP.md) will say.

Every statement in this section was applied to a Postgres 16 before it was
written down, and the behaviour checked rather than assumed: marking a task done
without supplying a timestamp is stamped rather than refused, reopening it
clears the timestamp, a task with both a `due_on` and a `due_at` is refused, a
second `about` link is refused, deleting a role removes its link and leaves the
task, and a link to another account's role is refused by the trigger. The
sketches are starting points for the migration, not the migration.

### `todo.dismissals`

The overlay, and the only thing this module stores about an obligation it does
not own.

```sql
-- One value in v1. It exists as an enum so that a second source is a new value
-- rather than a migration that reshapes a table with rows in it -- the same
-- reason obsidian.vault_provider has exactly one value.
create type todo.foreign_source as enum ('return_deadline');

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

Only return deadlines need this in v1. Job reminders do not, because deferring
one moves its own `due_at` and both pages then agree without an overlay at all;
note checkboxes do not, because that source is not built yet.

**Why a text key here when links get real foreign keys.** Because links point at
*rows* and dismissals point at *observations*. A return deadline is a column on
an order, not a row of its own, so there is no id to borrow and it gets a
derived one: the order's uuid, which is the whole derivation for the only source
that exists today.

The `source_key` is text rather than a uuid because the next source's key is
unlikely to be one. That is the only reason, and it is enough of one.

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

That policy decides who may *read and write a link row*. It says nothing about
what the row points at, which is a separate question with a separate answer —
the ownership trigger above. Both are needed and neither substitutes for the
other: the policy stops you seeing someone else's links, the trigger stops you
making one.

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

**Deferring.** Moves `due_at` forward on that same row, by the seven days
`SNOOZE_DAYS` already means everywhere else in the account. Deliberately *not* a
`todo.dismissals` row: a reminder's due date is what "not yet" has always meant
on the job side, so pushing it is the one write that both pages read. Store the
deferral in a todo-side table instead and finishing a reminder would agree
across the two pages while deferring one would not — you would hide something in
one place and keep seeing it in the other, which is how a person learns not to
trust either page.

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

Two directions, and only the cheap one is in v1.

### Notes as anchors — in v1

A task can be `about` a note, and a note's page in the viewer grows the same
small Tasks section a role page gets. No new machinery and no parsing:
`obsidian.notes.id` is stable across a delete and a restore precisely so that
citations survive a bad afternoon, and a task link is a citation.

This is most of the value and none of the difficulty. You are reading a note,
you think of something that has to happen, you write it down without leaving the
page, and it turns up on your agenda tomorrow anchored to what it came from.

### Checkboxes as an agenda source — not yet, and deliberately unchosen

**Nothing reads `- [ ]` out of a note in v1.** The source is in the registry as a
name and nothing else, off, with no implementation behind it. This section
exists to record why the decision is being left open rather than made badly now.

The obstacle is not the parsing. It is that **a checkbox is a line of text
inside a note, not a row in a table**, and every way of turning it into an
agenda item costs something:

1. **Read the note text in the app and find the lines there.** Simplest to
   write. It also means moving whole note bodies — capped at a megabyte each —
   across the wire on every load of the page you open first thing in the
   morning. `lib/vault/notes/load.ts` already selects `body` for up to 500 rows,
   so the pattern exists; but that is the vault's own list page, visited
   occasionally, not a daily agenda.
2. **Have the database return just the matching lines.** Far less data moves.
   The cost is that the rules for what counts as a task move into SQL, where
   Obsidian's formatting — nested lists, callouts, code fences, templates — is
   painful to get right and worse to test.
3. **Keep a small derived table of extracted lines, updated whenever a note
   changes.** Fastest to read and the only option that scales. It is also the
   most machinery, and it has to be genuinely derived — written by the database
   from the note, never by a second process — or it becomes exactly the
   duplicated-state problem this whole document exists to avoid.

The first draft of this spec picked a fourth thing — a generated column flagging
which notes contain a checkbox — and called the problem solved. It is not:
knowing *which* notes to look at does not reduce how much text has to be read to
find *which lines*. That column has been removed rather than left in as a
half-measure that looks like a decision.

**Why it is right to wait.** The vault is going to grow a proper parser — one
that turns markdown into something structured rather than leaving it as a wall
of text. When that exists, a checkbox stops being a line of text and becomes
structured data the vault already holds, and this whole question dissolves: the
todo module reads what the vault knows, option 3 without anyone building option
3 on its behalf. Committing to a bespoke extraction now would mean building
something to throw away, and worse, would put a second reader of note text in a
module that has no business parsing markdown at all.

So: the agenda's source interface is the commitment, and the checkbox source is
one implementation of it that gets written when the vault is ready to supply the
input. Nothing about the pages, the merge or the schema changes when it lands.

### When it does land, these still hold

Recorded now because they are the design, not the implementation, and they will
be just as true later:

- **Obsidian is the master, always.** A checkbox from a note is read-only here.
  There is no tick box, because ticking it would either write to your vault —
  which [VAULT-SPEC.md](VAULT-SPEC.md) forbids in its second sentence — or lie
  about having done so.
- **The way to act on one is to promote it**: copy it into a task you own, with
  a link back to the note it came from. Your copy is yours from that moment; the
  line in the vault is untouched, and nothing syncs back.
- **A promoted task never auto-completes** because the note's line was ticked
  upstream. It is your task now, and the app does not close things you did not
  close — it says the line has been ticked and lets you close it in one click.
- **The source is capped and scoped, not exhaustive.** A vault with four hundred
  stale `- [ ]` lines in daily notes from 2023 must not turn the agenda into a
  review queue. The vault never hands you a pile to triage, and this module must
  not become that queue by the back door.

## Integration: shopping

Smallest of the three, deliberately.

`orders.return_deadline` within the horizon, for orders not already returned,
appear as their own lane with the same dismissal overlay and a link to the
order. They are not tasks and cannot be completed — the deadline stops
mattering when the return exists or the date passes, and both of those are facts
the shopping side already derives.

`saved_items.cooldown_until` belongs to the anti-spending layer on the shopping
side ([BUILD-ORDER.md](BUILD-ORDER.md) step 19) and waits for it.

## Account settings, and module settings

The agenda has to know what day it is for you, and right now the account cannot
answer that question once.

**There are two `profiles` tables** — `public.profiles` and
`job_search.profiles` — each with its own `timezone`, each defaulting to
`'UTC'`. Only the job side has a screen that edits it
(`app/jobs/(app)/settings/view.tsx`); shopping merely prints the value
(`app/shopping/settings/page.tsx`). So the shopping half of the account has
almost certainly been on UTC since the day it was created, and a page that
merges all three workspaces has two candidate answers for "today" that are free
to disagree.

That has to be settled before anything renders a due date, and the fix is a
structural one that pays for itself across the whole app:

**Account settings, once, under the account icon.** The things that are true
about *you* regardless of which workspace you are in: timezone, display name,
display currency, which modules are turned on, and account deletion. One table:

```sql
create table core.account_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  display_currency text not null default 'USD',
  -- Which workspaces appear in the switcher and which sources may run.
  enabled_modules text[] not null default array['shopping','jobs','vault','todo'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`core` and not a new schema: this is the definition of a fact that arrives from
outside any workspace and that none of them owns, which is what `core` is for.
The migration copies each existing value across, preferring whichever profile
row has a non-default timezone, so nobody's setting changes underneath them. The
two `profiles.timezone` columns stay where they are for one release and then go,
rather than being dropped out from under code that still reads them.

**Module settings, under each module's own gear.** The things that only make
sense inside one workspace, staying exactly where they are: the Gmail connection
and merchant return windows in shopping, the ghost threshold and writing style
in jobs, the repository and token in the vault, and for this module the agenda
horizon and the source switches.

The line between the two is worth stating because it will be argued about later:
**if turning the module off would make the setting meaningless, it is a module
setting.** Timezone survives every module being off. The vault's repository does
not.

This is a change to the other three workspaces, not just to this one, which is
why it is its own build step and comes first.

## Surfaces

**A fourth workspace**, in the switcher, with `/todo` as its home. The switcher's
model is "which of these am I in", and a merged agenda is genuinely one of them
rather than a page inside any other.

- `/todo` — the agenda. Overdue, today, this week, then Someday collapsed.
  Sources appear inline in each day, visually secondary to the tasks you own. An
  empty agenda says so and is not padded out to look busy; `/jobs/today` already
  sets that tone and it is right.
- `/todo/all` — everything, including done and dropped, filterable by link and
  by status. The archive you consult, kept off the page you use daily.
- `/todo/settings` — the horizon, and a switch per source. Sources start off.

Inline, in the other workspaces: a Tasks section on the role, company, contact
and interview pages, and on a note. Small, a list plus one input, no page of its
own.

**On `/home`**, the top slice of the agenda — the two or three things due today —
under the workspace tiles. That page currently shows two counts and no reason to
visit it; this is the reason.

## The agenda merge

```
lib/todo/
  agenda/
    sources.ts     the AgendaSource interface and the registry
    sources/
      job-reminders.ts
      return-deadlines.ts
      (note-checkboxes.ts -- later, when the vault can supply the input)
    load.ts        the enabled sources, in parallel, plus batched labels
    merge.ts       PURE. lanes, ordering, dismissal application, dedupe
    merge.test.ts
  tasks/
    load.ts        list, filter
    write.ts       create, edit, complete, drop, snooze
  links/
    load.ts        "tasks about this role", for the inline sections
  db/
    schema-name.ts TODO_SCHEMA + the typed client, as the vault has
  auth/
    server.ts      a Supabase client bound to `todo`, anon key, RLS applies
```

`merge.ts` takes already-fetched lists, the dismissal rows and an explicit
`now`, and returns the lanes. No client, no clock of its own, no I/O. Everything
that could be wrong about an agenda — a snooze that has expired, an overdue
item sorting after a future one, a dismissal that should still be hiding
something, a day boundary landing in the wrong timezone — is a table test in
`merge.test.ts` and needs no database. This is the shape `lib/vault/sync/plan.ts`
uses and the reason that sync's decisions are testable at all.

`load.ts` needs one supabase client per schema, because a client is bound to one
schema. `app/home/page.tsx` already creates two side by side; this is the same
thing with a couple more. They run in one `Promise.all`, and a source that fails
degrades to empty with the failure surfaced rather than taking the page down —
your own todos must render when the vault's token has expired.

**Labels are fetched in one pass per module, never per task.** A link stores an
id; the agenda needs a name — "Acme · Staff Engineer" beside the task, not a
uuid. Because each module's data is read through its own client, that name is a
second lookup, and the obvious shape (resolve each task's link as it renders) is
a query per row. So `load.ts` collects the ids by target type first and asks
each module once: one query for every role on the page, one for every company,
and so on. Six extra queries in the worst case, flat, no matter how long the
list is.

Worth being plain that this makes "one query per source, in parallel"
optimistic: an
agenda with tasks anchored to several kinds of thing is closer to ten. All of
them are indexed primary-key lookups over tens of ids, and they run together —
but the number is the number, and a later change that turns it into one query
per row will not feel slow until the list is long.

## Rules

Candidates for the README's Rules section once this ships, because they are the
ones that will otherwise be violated by a well-meaning later commit.

- **The todo module never copies a row out of another schema.** A foreign
  obligation is read at query time by its source; the only thing stored about
  one is a dismissal.
- **A foreign key is not an ownership check.** Referential integrity in Postgres
  bypasses row level security, so every cross-schema link is checked by a
  trigger as well, and `tests/rls-todo.test.ts` asserts a link to another
  account's row is refused.
- **A task about something is a foreign key**, not a text field holding a name.
  If the role is deleted the link goes with it.
- **Nothing in this module writes to the vault.** Enforced by the existing
  boundary: the vault's provider interface is read-only and lint already stops
  anything outside `lib/vault/providers/` from reaching git at all.
- **Deferring a job reminder moves its own due date.** There is no second place
  a job reminder can be hidden, because two places would disagree.
- **Every source goes through the registry.** A page that queries a workspace
  directly for agenda items is a source that cannot be switched off, tested in
  isolation, or replaced when its input changes shape.
- **The agenda merge is pure and takes its clock and timezone as arguments.** A
  function that calls `Date.now()` inside cannot be tested for "overdue", and
  one that reads the timezone itself cannot be tested for "which day is this".
- **Settings that survive every module being off belong to the account**, under
  the account icon, in `core.account_settings`. Everything else belongs to its
  module's own settings page.

## Build order

Each step is shippable on its own, and the module is useful after step 26.

24. **Account settings.** `core.account_settings`, the timezone moved into it
    from the two `profiles` rows, an account settings page behind the account
    icon, and each module's settings left where they are behind its own gear.
    This is a change to all three existing workspaces and it comes first
    because everything below renders a date.
25. **Schema, RLS, isolation test.** `supabase/migrations-todo/0001_todo_schema.sql`,
    `tests/rls-todo.test.ts`, `tests/helpers/db-todo.ts`, `todo` added to
    `db-reset.sh` and to the exposed-schemas assertion. The isolation test
    covers the ownership trigger, not just the policies. No feature code. This
    is step 2 of the original build order repeating itself for a reason: a
    missing check fails now rather than in six months.
26. **The list you typed.** `/todo`, `/todo/all`, create, edit, complete, drop,
    snooze, due dates, pinned. Fourth entry in `WORKSPACES`. Zero integration —
    and already worth having.
27. **Links and the inline sections.** `todo.task_links` with its ownership
    trigger, and a Tasks section on the role, company, contact and interview
    pages and on a note. This is the whole vault integration for now, and it is
    the half of it that costs nothing.
28. **The source registry.** `AgendaSource`, the switches in `/todo/settings`,
    batched label lookups, and the merge — with zero sources implemented. A
    scaffold with nothing plugged in sounds like a step to skip; it is the step
    that decides whether the next three are one file each or a rewrite.
29. **The job source.** Reminders on the agenda with the follow-up composer
    intact (`fd33268` applies here with full force), completion writing
    `completed_at` and deferral moving `due_at`, both on the job row.
    Interviews as day context rather than as items.
30. **The shopping source.** `orders.return_deadline` within the horizon, and
    the one `todo.dismissals` source that exists.
31. **`/home`.** The top slice of the agenda on the front door, which currently
    shows two counts and no reason to visit.

Not in this list, deliberately: reading checkboxes out of notes. It waits for
the vault to hold notes as something more structured than text, and is then one
file against the interface from step 28.

## Open questions

- **Recurrence, which may not survive being deferred.** "Renew the passport",
  "pay the service charge", "book the dentist" — personal admin is the most
  repetition-heavy category there is, and it is the category that justified the
  module. A v1 without it may miss the point of its own argument. The cheap
  version is a `repeat_every_days` on the task and a new row generated when one
  is completed; the correct version is calendar rules and exceptions. If the
  cheap version is enough, it belongs in step 26 rather than in a later phase.
- **The horizon.** `/jobs/today` uses 14 days for interviews and 7 for
  reminders. The agenda probably wants 7 with everything beyond it collapsed
  into "later", but that is a number to set after looking at a real week, not
  before.
- **Ordering within a day.** Due time, then pinned, then created? Or a manual
  drag order, which means a `position` column and the fractional-index problem?
  v1 sorts and does not drag. Revisit only if it actually grates.
- **Whether the fourth workspace is one surface too many.** The smaller version
  is `todo.tasks`, the inline sections, and the agenda living on `/home` — no
  switcher entry, no `/todo/all`, two fewer steps. The argument against is that
  `/home` then has two jobs and does neither of them first.
- **What replaces the two `profiles` tables in the end.** Step 24 moves the
  account-level columns out and leaves the module-level ones behind, which is
  the right first cut. Whether `job_search.profiles` and `public.profiles`
  eventually become one table of module preferences is a question for whenever
  the second one of them is nearly empty.

## What changed in the building

Recorded rather than edited away, because each of these is a place the spec was
confident and the code disagreed.

- **The timezone could not simply move.** About thirty call sites read
  `profiles.timezone`, and rewriting them all would have turned a prerequisite
  into a refactor of two products. `core.account_settings` is the one writer;
  a trigger keeps both `profiles` columns true. They are mirrors maintained by
  the database, not a second writer, and they retire whenever their readers do.
- **The ownership trigger has to let the check constraint speak.** A BEFORE
  trigger runs first, so a link pointing at nothing was answered with "you do
  not own that" — sending someone after a permissions problem they do not have.
  It now returns early when the row does not name exactly one target.
- **Interviews needed their own type.** `AgendaItem` assumed everything could
  at least be dismissed; an interview cannot sensibly be. `DayContext` sits
  alongside it, is rendered without a checkbox, and a day holding only an
  interview still renders — "an interview on Thursday and nothing else" is an
  answer.
- **`lastCorrespondents` moved** out of `lib/jobs/today/load.ts` into
  `lib/jobs/followup/recipients.ts`. Two pages address the same draft now, and
  two copies of that logic would have drifted.
- **The select list in `lib/todo/links/load.ts` is written out by hand.**
  supabase-js parses it at the type level and a computed string degrades the
  whole result to an error type. A test asserts it names every target column,
  because otherwise a seventh target would be added everywhere else and simply
  never come back from the query.
- **`todo.agenda_settings` was not in the schema section** and needed to be:
  the horizon and the source switches are module settings, and the source
  registry is useless without somewhere to record which sources are on.
- **`countOpenTasks` is imported dynamically on `/home`.** A static import
  pulled the todo client into a page that must still render when the module is
  switched off.

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
- **Checkboxes from notes**, once the vault holds a note as something more
  structured than a body of text. One file against the source interface, a
  switch that starts off, and promotion as the only way a line becomes a task
  you own. Everything about how it should behave is already written down under
  "Integration: vault notes"; only the mechanism is missing, and it is missing
  on purpose.
