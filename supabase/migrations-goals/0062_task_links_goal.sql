-- ===========================================================================
-- A task can be about a goal (plan #1263).
--
-- Hand to Dash on a Todo task makes an errand in Goals from it and closes the
-- task. The task then has to say where it went, and the place a task already
-- says what it is about is todo.task_links: one row, one target, drawn as the
-- chip beside the task. So the link gets a thirteenth target, goal_id, in the
-- shape the other twelve have (migrations-todo/0004): a nullable foreign key
-- cascading on delete, a partial index for the reverse read, one more name in
-- the exactly-one check and one more arm in the ownership trigger.
--
-- It lives in migrations-goals rather than migrations-todo because it points
-- at goals.items, and scripts/db-reset.sh applies goals after todo.
--
-- Archiving a goal leaves its row, so the link survives an archive and goes
-- only when the goal is deleted.
-- ===========================================================================

alter table todo.task_links
  add column if not exists goal_id uuid
    references goals.items (id) on delete cascade;

alter table todo.task_links drop constraint if exists task_links_exactly_one_ck;
alter table todo.task_links add constraint task_links_exactly_one_ck check (
  num_nonnulls(application_id, role_id, company_id, contact_id, interview_id,
               note_id, order_id, inventory_item_id, saved_item_id, reading_id,
               track_id, subject_id, goal_id) = 1
);

create index if not exists task_links_goal_idx on todo.task_links (goal_id)
  where goal_id is not null;

-- ---------------------------------------------------------------------------
-- The ownership check, over thirteen targets. Unchanged from 0004 but for the
-- goal arm and `goals` on the search_path: a foreign key is still not an
-- ownership check, because Postgres performs referential integrity checks
-- bypassing row level security.
-- ---------------------------------------------------------------------------
create or replace function todo.task_link_target_is_owned()
returns trigger
language plpgsql
security definer
set search_path = todo, job_search, obsidian, learn, goals, public
as $$
declare
  owner uuid;
  task_owner uuid;
begin
  -- Let the check constraint speak when the row points at nothing, or at more
  -- than one thing.
  if num_nonnulls(new.application_id, new.role_id, new.company_id,
                  new.contact_id, new.interview_id, new.note_id,
                  new.order_id, new.inventory_item_id, new.saved_item_id,
                  new.reading_id, new.track_id, new.subject_id,
                  new.goal_id) <> 1 then
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
    when new.order_id is not null then
      (select user_id from public.orders where id = new.order_id)
    when new.inventory_item_id is not null then
      (select user_id from public.inventory_items where id = new.inventory_item_id)
    when new.saved_item_id is not null then
      (select user_id from public.saved_items where id = new.saved_item_id)
    when new.reading_id is not null then
      (select user_id from learn.readings where id = new.reading_id)
    when new.track_id is not null then
      (select user_id from learn.tracks where id = new.track_id)
    when new.subject_id is not null then
      (select user_id from learn.subjects where id = new.subject_id)
    when new.goal_id is not null then
      (select user_id from goals.items where id = new.goal_id)
  end into owner;

  if owner is null or task_owner is null or owner <> task_owner then
    raise exception 'a task link must point at something the task''s owner owns';
  end if;

  return new;
end;
$$;

revoke all on function todo.task_link_target_is_owned() from public, anon, authenticated;

comment on column todo.task_links.goal_id is
  'The goal a task is about. Written when a task is handed to Dash as an errand (plan #1263).';

notify pgrst, 'reload schema';
