-- Comments on an idea, a plan step or a raise.
--
-- `raised_comments` (0058) already held a thread of 'me' and 'claude' messages
-- under one raise, and the same exchange is wanted on the other two rows the
-- dev pages show: a question about an idea before it is shaped, a note on a
-- step while it is being built. One table covers all three, so a thread reads
-- and writes the same way wherever it is shown. The rename keeps the rows that
-- are already there.
--
-- Three nullable foreign keys rather than a (target_kind, target_id) pair. The
-- pair is shorter to write and gives up the two things that matter here:
-- Postgres cannot cascade a delete through it, so a deleted idea would leave
-- its thread behind, and the insert policy could not check the target is
-- yours without a lookup per kind anyway. `num_nonnulls` = 1 is what says a
-- comment is about exactly one thing.
--
-- The ownership check stays in the insert policy, as 0058 put it: all four
-- tables are in `public` and the parent is readable under the same policies,
-- so `exists (… where user_id = auth.uid())` is evaluated against rows the
-- caller can already see.

set search_path = public, extensions;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'raised_comments')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'dev_comments')
  then
    alter table raised_comments rename to dev_comments;
  end if;

  if exists (select 1 from pg_constraint where conname = 'raised_comments_pkey') then
    alter table dev_comments rename constraint raised_comments_pkey to dev_comments_pkey;
  end if;

  if exists (select 1 from pg_constraint where conname = 'raised_comments_user_id_fkey') then
    alter table dev_comments
      rename constraint raised_comments_user_id_fkey to dev_comments_user_id_fkey;
  end if;

  if exists (select 1 from pg_constraint where conname = 'raised_comments_raised_item_id_fkey') then
    alter table dev_comments
      rename constraint raised_comments_raised_item_id_fkey to dev_comments_raised_item_id_fkey;
  end if;
end $$;

alter table dev_comments
  alter column raised_item_id drop not null,
  add column if not exists idea_id uuid references ideas (id) on delete cascade,
  add column if not exists plan_item_id uuid references plan_items (id) on delete cascade;

-- Carried over from 0058 under the new name, so nothing reads as debris from a
-- table that no longer exists.
alter table dev_comments drop constraint if exists raised_comments_author_ck;
alter table dev_comments drop constraint if exists raised_comments_body_not_blank_ck;
alter table dev_comments drop constraint if exists raised_comments_body_length_ck;

alter table dev_comments drop constraint if exists dev_comments_author_ck;
alter table dev_comments add constraint dev_comments_author_ck
  check (author in ('me', 'claude'));
alter table dev_comments drop constraint if exists dev_comments_body_not_blank_ck;
alter table dev_comments add constraint dev_comments_body_not_blank_ck
  check (length(btrim(body)) > 0);
alter table dev_comments drop constraint if exists dev_comments_body_length_ck;
alter table dev_comments add constraint dev_comments_body_length_ck
  check (length(body) <= 4000);

alter table dev_comments drop constraint if exists dev_comments_one_target_ck;
alter table dev_comments add constraint dev_comments_one_target_ck
  check (num_nonnulls(idea_id, plan_item_id, raised_item_id) = 1);

-- One index per target, each the order the thread is read in: oldest first,
-- under the row it is about.
drop index if exists raised_comments_item_created_idx;
create index if not exists dev_comments_raise_idx
  on dev_comments (raised_item_id, created_at) where raised_item_id is not null;
create index if not exists dev_comments_idea_idx
  on dev_comments (idea_id, created_at) where idea_id is not null;
create index if not exists dev_comments_plan_item_idx
  on dev_comments (plan_item_id, created_at) where plan_item_id is not null;

alter table dev_comments enable row level security;

drop policy if exists raised_comments_select on dev_comments;
drop policy if exists raised_comments_insert on dev_comments;
drop policy if exists raised_comments_update on dev_comments;
drop policy if exists raised_comments_delete on dev_comments;

drop policy if exists dev_comments_select on dev_comments;
create policy dev_comments_select on dev_comments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists dev_comments_insert on dev_comments;
create policy dev_comments_insert on dev_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      exists (
        select 1 from raised_items r
        where r.id = raised_item_id and r.user_id = (select auth.uid())
      )
      or exists (
        select 1 from ideas i
        where i.id = idea_id and i.user_id = (select auth.uid())
      )
      or exists (
        select 1 from plan_items p
        where p.id = plan_item_id and p.user_id = (select auth.uid())
      )
    )
  );
drop policy if exists dev_comments_update on dev_comments;
create policy dev_comments_update on dev_comments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists dev_comments_delete on dev_comments;
create policy dev_comments_delete on dev_comments for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out.
grant select, insert, update, delete on dev_comments to authenticated;

revoke all on table dev_comments from anon;
