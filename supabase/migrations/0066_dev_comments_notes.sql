-- A comment on a bug report or a feature request.
--
-- `dev_comments` (0064) holds a thread under an idea, a plan step and a raise.
-- A note in `feedback_items` is the fourth row the dev pages show and the one
-- place extra detail still had nowhere to go: it went back into the note's own
-- body, which is the report as it was filed and should not grow a conversation
-- inside it.
--
-- A fourth nullable foreign key rather than a (target_kind, target_id) pair,
-- for the reasons 0064 spells out: the cascade is what stops a deleted note
-- leaving its thread behind, and `num_nonnulls` = 1 is what says a comment is
-- about exactly one thing.

set search_path = public, extensions;

alter table dev_comments
  add column if not exists feedback_item_id uuid references feedback_items (id) on delete cascade;

alter table dev_comments drop constraint if exists dev_comments_one_target_ck;
alter table dev_comments add constraint dev_comments_one_target_ck
  check (num_nonnulls(idea_id, plan_item_id, raised_item_id, feedback_item_id) = 1);

-- The order the thread is read in, as the other three targets have it.
create index if not exists dev_comments_feedback_idx
  on dev_comments (feedback_item_id, created_at) where feedback_item_id is not null;

-- Rewritten whole rather than added to: a policy is replaced, not extended,
-- and the other three branches have to survive the replacement.
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
      or exists (
        select 1 from feedback_items f
        where f.id = feedback_item_id and f.user_id = (select auth.uid())
      )
    )
  );
