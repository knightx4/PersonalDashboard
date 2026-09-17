-- What CI said about the commit a step shipped in.
--
-- A closed step keeps the commit it was closed at, and the plan page drew that
-- sha and nothing else. So a step that landed on a commit whose checks were
-- red looked exactly like one that landed on a green one, and the only way to
-- find out was to open GitHub and match a sha by eye.
--
-- The answer is read off the commit on main that carried the step's commit
-- there, not off the commit as recorded: work is committed on a branch and
-- merged into main in one go, and the checks only run on main and on pull
-- requests. #555 settled that. `merge_sha` is the commit the checks were
-- actually read from, so a row says which question was asked as well as what
-- came back.
--
-- One row per recorded commit rather than per step, because two steps closed
-- at the same commit are one question, and because the recorded sha is what
-- the lookup starts from. It is a cache of a remote answer: deleting the table
-- costs a re-read and nothing else.
--
-- `checked_at` is when GitHub was asked. A run that was still going or a
-- commit that had not reached main yet is asked again later; passed and failed
-- are final and are not.

set search_path = public, extensions;

create table if not exists plan_commit_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The commit as the step records it, short or full. Not a foreign key: a
  -- step can be re-closed at another commit and the answer for this one stays
  -- worth keeping.
  commit_sha text not null,
  -- The commit on main whose checks were read. Null when nothing on main
  -- carried this commit there.
  merge_sha text,
  conclusion text not null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint plan_commit_checks_conclusion_ck check (
    conclusion in ('passed', 'failed', 'running', 'none', 'unmerged')
  ),
  constraint plan_commit_checks_commit_sha_ck check (
    commit_sha ~ '^[0-9a-f]{7,40}$'
  ),
  constraint plan_commit_checks_merge_sha_ck check (
    merge_sha is null or merge_sha ~ '^[0-9a-f]{7,40}$'
  ),
  -- Nothing carried it there, so there is nothing to have read checks from.
  constraint plan_commit_checks_unmerged_has_no_merge_ck check (
    conclusion <> 'unmerged' or merge_sha is null
  ),
  constraint plan_commit_checks_one_per_commit_uq unique (user_id, commit_sha)
);

-- The one question asked of it: what does this account know about the commits
-- its steps shipped in.
create index if not exists plan_commit_checks_user_idx
  on plan_commit_checks (user_id, checked_at desc);

alter table plan_commit_checks enable row level security;

drop policy if exists plan_commit_checks_select on plan_commit_checks;
create policy plan_commit_checks_select on plan_commit_checks for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists plan_commit_checks_insert on plan_commit_checks;
create policy plan_commit_checks_insert on plan_commit_checks for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists plan_commit_checks_update on plan_commit_checks;
create policy plan_commit_checks_update on plan_commit_checks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists plan_commit_checks_delete on plan_commit_checks;
create policy plan_commit_checks_delete on plan_commit_checks for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out.
grant select, insert, update, delete on plan_commit_checks to authenticated;

revoke all on table plan_commit_checks from anon;
