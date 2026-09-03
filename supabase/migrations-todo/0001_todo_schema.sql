-- The todo module: a fifth schema, for the things you have to do.
--
-- Specified in docs/TODO-SPEC.md. The rule everything here serves, and the one
-- to read this file against:
--
--   An obligation is displayed by whoever needs to show it and written by
--   whoever owns it.
--
-- So this schema holds the tasks you typed and nothing else. A job reminder is
-- finished and deferred on job_search's own row; a return deadline is a date
-- derived by public.sync_order_state(); a checkbox in a note belongs to
-- Obsidian and is not read at all yet. What this schema stores about any of
-- them is one thing: that you dismissed it.
--
-- Applied last by scripts/db-reset.sh, after migrations, migrations-job-search
-- and migrations-vault, because the foreign keys below point into all three.
-- A fresh Supabase project must be migrated in the same order.
--
-- `todo` was checked against what Supabase ships on every project before it was
-- chosen. That is the lesson of `obsidian`, which is called that because
-- `vault` was already taken by Supabase Vault and creating tables there would
-- have published the secrets store. `todo` collides with nothing.

create schema if not exists todo;

set search_path = todo, public, extensions;

create type todo.task_status as enum ('open', 'done', 'dropped');

-- ---------------------------------------------------------------------------
-- tasks -- the only thing in the account this module actually owns.
-- ---------------------------------------------------------------------------
create table todo.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  -- Optional detail, markdown, rendered by the same component the vault uses.
  body text,

  status todo.task_status not null default 'open',
  -- Stamped by a trigger, not by the caller. See below.
  completed_at timestamptz,
  dropped_at timestamptz,

  -- A due DATE and a due INSTANT are different things and the difference
  -- shows. "Tuesday" is a date: it must not move because you flew to Lisbon.
  -- Something pinned to a 14:00 interview is an instant and must move. At most
  -- one is set; neither means someday.
  due_on date,
  due_at timestamptz,

  pinned boolean not null default false,
  -- The "Later" half, the same shape job_search's dismissal tables use.
  snoozed_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint tasks_one_due_ck check (num_nonnulls(due_on, due_at) <= 1),
  constraint tasks_completed_ck check (
    (status = 'done') = (completed_at is not null)
    and (status = 'dropped') = (dropped_at is not null)
  )
);

-- Two indexes rather than one over `coalesce(due_on, due_at::date)`, which
-- Postgres refuses outright: timestamptz -> date depends on the session's
-- TimeZone and so is not immutable, and an index expression must be. Which is
-- the same fact that made the two columns necessary, saying itself twice.
create index tasks_user_due_on_idx on todo.tasks (user_id, due_on)
  where status = 'open' and due_on is not null;
create index tasks_user_due_at_idx on todo.tasks (user_id, due_at)
  where status = 'open' and due_at is not null;
create index tasks_user_status_idx on todo.tasks (user_id, status, created_at desc);

-- There is no `source` column and no key pointing at where a task came from.
-- Both belong to promotion -- copying a checkbox out of a note -- which is not
-- built, and a column carrying a deferred feature's shape is a guess about
-- that feature made before it was designed. One migration when it is real.

-- ---------------------------------------------------------------------------
-- The database stamps the timestamps; it does not merely check them.
--
-- The constraint above says a `done` row must have a `completed_at`. On its own
-- that turns "mark this done" into an error every time a caller updates the
-- status and forgets the timestamp, and one caller eventually will.
--
-- Reopening a finished task clears the stamp rather than leaving a stale one,
-- which is why the `case` has no `else`: null is the correct value for "not
-- finished", and the constraint then agrees with the status by construction.
-- The constraint stays anyway -- a trigger can be dropped, and the rule it
-- upholds should not disappear with it.
-- ---------------------------------------------------------------------------
create or replace function todo.stamp_task_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) end;
    new.dropped_at := case when new.status = 'dropped' then coalesce(new.dropped_at, now()) end;
  end if;
  return new;
end;
$$;

alter function todo.stamp_task_status() set search_path = todo;
revoke all on function todo.stamp_task_status() from public, anon, authenticated;

create trigger tasks_stamp_status
  before update of status on todo.tasks
  for each row execute function todo.stamp_task_status();

-- ---------------------------------------------------------------------------
-- task_links -- what a task is about, and where it came from.
--
-- Real foreign keys, into three other schemas, because they are all in one
-- database and a cross-schema foreign key costs nothing and buys the cascade
-- for free: delete the role and its tasks' links go with it, while the tasks
-- themselves survive.
--
-- The "exactly one parent from N" shape is lifted from job_search.notes, which
-- takes one parent from five. Adding a seventh target later is one column and
-- one edited check constraint.
--
-- These keys tie the schemas together at the database level, which is the
-- point and is also a trade: the job side could no longer be lifted out into a
-- separate database without dropping them first. That is accepted deliberately
-- -- this is one integrated app for one person, and integration is the entire
-- reason the module exists. Turning a module off is a display setting; it
-- deletes nothing and breaks no link.
-- ---------------------------------------------------------------------------
create type todo.link_relation as enum ('about', 'source');

create table todo.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references todo.tasks (id) on delete cascade,
  -- Only `about` is used today. `source` is what a task copied out of a note
  -- will carry when promotion exists; it is in the enum now because adding an
  -- enum value later is a migration and adding a use for one is not.
  relation todo.link_relation not null default 'about',

  application_id uuid references job_search.applications (id) on delete cascade,
  role_id uuid references job_search.roles (id) on delete cascade,
  company_id uuid references job_search.companies (id) on delete cascade,
  contact_id uuid references job_search.contacts (id) on delete cascade,
  interview_id uuid references job_search.interviews (id) on delete cascade,
  note_id uuid references obsidian.notes (id) on delete cascade,

  created_at timestamptz not null default now(),

  constraint task_links_exactly_one_ck check (
    num_nonnulls(application_id, role_id, company_id, contact_id, interview_id, note_id) = 1
  )
);

-- At most one 'about' per task: a task is about one thing. It may cite several.
create unique index task_links_about_key on todo.task_links (task_id)
  where relation = 'about';

-- The reverse read -- "what is outstanding on this role" -- is the one the
-- inline sections make on every role, company, contact and note page.
create index task_links_role_idx on todo.task_links (role_id) where role_id is not null;
create index task_links_application_idx on todo.task_links (application_id)
  where application_id is not null;
create index task_links_company_idx on todo.task_links (company_id) where company_id is not null;
create index task_links_contact_idx on todo.task_links (contact_id) where contact_id is not null;
create index task_links_interview_idx on todo.task_links (interview_id)
  where interview_id is not null;
create index task_links_note_idx on todo.task_links (note_id) where note_id is not null;
create index task_links_task_idx on todo.task_links (task_id);

-- ---------------------------------------------------------------------------
-- dismissals -- the only thing stored about an obligation this module does not
-- own.
--
-- One source value in v1. It is an enum so that a second source is a new value
-- rather than a migration reshaping a table with rows in it -- the same reason
-- obsidian.vault_provider has exactly one value.
--
-- Job reminders are not here: deferring one moves its own due_at, so both
-- /jobs/today and /todo agree without an overlay at all. Note checkboxes are
-- not here because that source is not built.
-- ---------------------------------------------------------------------------
create type todo.foreign_source as enum ('return_deadline');

create table todo.dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source todo.foreign_source not null,
  -- Stable identity WITHIN that source. Not a foreign key, because links point
  -- at rows and dismissals point at observations: a return deadline is a
  -- column on an order, not a row of its own, so there is no id to borrow and
  -- it gets a derived one -- the order's uuid, which is the whole derivation
  -- for the only source that exists today. Text rather than uuid because the
  -- next source's key is unlikely to be one.
  source_key text not null,
  -- Null means "for good". Set means "Later", the same distinction the
  -- reminders table draws with due_at vs completed_at.
  dismissed_until timestamptz,
  created_at timestamptz not null default now(),

  unique (user_id, source, source_key)
);

-- ---------------------------------------------------------------------------
-- updated_at. Its own copy, as obsidian and core have their own copies, so the
-- schema does not depend on another schema's function surviving a refactor.
-- ---------------------------------------------------------------------------
create or replace function todo.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function todo.touch_updated_at() set search_path = todo;
revoke all on function todo.touch_updated_at() from public, anon, authenticated;

create trigger tasks_touch_updated_at
  before update on todo.tasks
  for each row execute function todo.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Every table, from the first migration.
-- ---------------------------------------------------------------------------
alter table todo.tasks enable row level security;
alter table todo.task_links enable row level security;
alter table todo.dismissals enable row level security;

create policy tasks_all on todo.tasks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy dismissals_all on todo.dismissals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- task_links has no user_id of its own and is policed through its task. This
-- decides who may read and write a link ROW. It says nothing about what the row
-- points at, which is a separate question with a separate answer below.
create policy task_links_all on todo.task_links for all to authenticated
  using (exists (
    select 1 from todo.tasks t
    where t.id = task_links.task_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from todo.tasks t
    where t.id = task_links.task_id and t.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- A link must point at something you own.
--
-- **A foreign key is not an ownership check**, and this is the one place in the
-- module where getting that wrong would matter. Postgres performs referential
-- integrity checks bypassing row level security -- documented behaviour, not a
-- quirk -- so the foreign key to job_search.roles is satisfied by ANY role in
-- the table, including one belonging to another account. The policy above only
-- asks who owns the task. Nothing in it stops a link pointing across accounts.
--
-- So the database checks it. This is the same defence obsidian.notes already
-- runs, where a note's denormalised user_id must equal its connection's owner.
--
-- security definer because the function has to see rows the caller's policies
-- would hide -- which is exactly why it is written narrowly, pinned to a fixed
-- search_path, and revoked from every role that could call it directly.
--
-- One extra lookup per link written, and links are written when you create or
-- edit a task. Not a hot path, and not close to one.
-- ---------------------------------------------------------------------------
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
  -- Let the check constraint speak when the row points at nothing, or at more
  -- than one thing. A BEFORE trigger runs first, and answering "you pointed at
  -- nothing" with "you do not own that" would send someone looking for a
  -- permissions problem they do not have.
  if num_nonnulls(new.application_id, new.role_id, new.company_id,
                  new.contact_id, new.interview_id, new.note_id) <> 1 then
    return new;
  end if;

  select user_id into task_owner from todo.tasks where id = new.task_id;

  select case
    when new.application_id is not null then
      (select user_id from job_search.applications where id = new.application_id)
    when new.role_id is not null then
      (select user_id from job_search.roles where id = new.role_id)
    when new.company_id is not null then
      (select user_id from job_search.companies where id = new.company_id)
    when new.contact_id is not null then
      (select user_id from job_search.contacts where id = new.contact_id)
    when new.interview_id is not null then
      (select user_id from job_search.interviews where id = new.interview_id)
    when new.note_id is not null then
      (select user_id from obsidian.notes where id = new.note_id)
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

-- Nothing here is readable by an anonymous visitor.
revoke all on all tables in schema todo from anon;

grant usage on schema todo to authenticated, service_role;
grant select, insert, update, delete on all tables in schema todo to authenticated, service_role;
