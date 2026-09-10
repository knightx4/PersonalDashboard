-- ---------------------------------------------------------------------------
-- 0004 -- a task can be about anything you own.
--
-- task_links started with six targets, all of them in job_search and obsidian,
-- because the only places a link was ever written from were pages in those two
-- modules. Linking from /todo means typing a few letters and picking whatever
-- comes back, and the search behind that box already finds orders, inventory,
-- saved items, readings and tracks as readily as it finds roles. A picker over
-- the old six would answer half of those queries with an empty list and
-- nothing on screen to say why.
--
-- So: six more columns, in the shape the first six already have. One nullable
-- foreign key each, cascading on delete, a partial index for the reverse read,
-- one more name in the exactly-one check and one more arm in the ownership
-- trigger.
--
-- This file points at learn.readings, learn.tracks and learn.subjects, so it
-- has to run after migrations-learn. scripts/db-reset.sh applies learn before
-- todo for that reason; nothing in learn points back at todo.
-- ---------------------------------------------------------------------------

alter table todo.task_links
  add column if not exists order_id uuid
    references public.orders (id) on delete cascade,
  add column if not exists inventory_item_id uuid
    references public.inventory_items (id) on delete cascade,
  add column if not exists saved_item_id uuid
    references public.saved_items (id) on delete cascade,
  add column if not exists reading_id uuid
    references learn.readings (id) on delete cascade,
  add column if not exists track_id uuid
    references learn.tracks (id) on delete cascade,
  add column if not exists subject_id uuid
    references learn.subjects (id) on delete cascade;

-- Still exactly one. A link that pointed at two things would have two answers
-- to "what is this task about", and the row that renders it takes one.
alter table todo.task_links drop constraint if exists task_links_exactly_one_ck;
alter table todo.task_links add constraint task_links_exactly_one_ck check (
  num_nonnulls(application_id, role_id, company_id, contact_id, interview_id,
               note_id, order_id, inventory_item_id, saved_item_id, reading_id,
               track_id, subject_id) = 1
);

-- The reverse read -- "what is outstanding on this order" -- is the one an
-- inline Tasks section makes, the same as the six that came before.
create index if not exists task_links_order_idx on todo.task_links (order_id)
  where order_id is not null;
create index if not exists task_links_inventory_item_idx
  on todo.task_links (inventory_item_id) where inventory_item_id is not null;
create index if not exists task_links_saved_item_idx
  on todo.task_links (saved_item_id) where saved_item_id is not null;
create index if not exists task_links_reading_idx on todo.task_links (reading_id)
  where reading_id is not null;
create index if not exists task_links_track_idx on todo.task_links (track_id)
  where track_id is not null;
create index if not exists task_links_subject_idx on todo.task_links (subject_id)
  where subject_id is not null;

-- ---------------------------------------------------------------------------
-- The ownership check, over twelve targets instead of six.
--
-- Unchanged in every way that matters: a foreign key is still not an ownership
-- check, Postgres still performs referential integrity checks bypassing row
-- level security, and the policy on task_links still only asks who owns the
-- task. `learn` joins the search_path because three of the new targets live
-- there.
-- ---------------------------------------------------------------------------
create or replace function todo.task_link_target_is_owned()
returns trigger
language plpgsql
security definer
set search_path = todo, job_search, obsidian, learn, public
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
                  new.contact_id, new.interview_id, new.note_id,
                  new.order_id, new.inventory_item_id, new.saved_item_id,
                  new.reading_id, new.track_id, new.subject_id) <> 1 then
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
  end into owner;

  if owner is null or task_owner is null or owner <> task_owner then
    raise exception 'a task link must point at something the task''s owner owns';
  end if;

  return new;
end;
$$;

revoke all on function todo.task_link_target_is_owned() from public, anon, authenticated;
