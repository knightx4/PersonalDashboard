-- ===========================================================================
-- A task can be about an appointment from a subscribed calendar (plan #1373,
-- under #1371).
--
-- The other thirteen targets of todo.task_links are foreign keys to a row that
-- stays put. A subscribed appointment has no such row: todo.feed_events is a
-- copy that every refresh deletes and writes again (lib/todo/feeds/refresh.ts),
-- so a key to one of its ids would break within the hour. Until now the app
-- refused these links for that reason (migrations-todo/0007).
--
-- So the fourteenth target names the appointment the way the calendar does,
-- and the page finds the current copy each time it draws:
--
--   feed_id          a real key to todo.calendar_feeds, cascading on delete.
--                    Removing a subscription removes the links into it and
--                    leaves the tasks, as deleting a role does.
--   feed_uid         the UID the calendar file gives the appointment.
--   feed_occurrence  for a repeating one, which date (todo.feed_events.
--                    occurrence, plan #1372); null for a one-off. A task about
--                    a weekly meeting is about one date of it.
--   feed_title,      the name and start it had when it was linked, shown with
--   feed_starts_on / "no longer on <calendar>" once no copy matches, so a
--   feed_starts_at   cancelled meeting still says what the task was about.
--
-- The current copy is matched on (feed_id, feed_uid, feed_occurrence) against
-- feed_events (feed_id, uid, occurrence), which feed_events_feed_uid_occurrence_idx
-- already serves.
--
-- It lives in migrations-goals rather than migrations-todo because 0062 here
-- rewrote the exactly-one check and the ownership trigger, and
-- scripts/db-reset.sh applies goals after todo: a todo migration would be
-- overwritten by 0062 on every local reset.
-- ===========================================================================

alter table todo.task_links
  add column if not exists feed_id uuid
    references todo.calendar_feeds (id) on delete cascade,
  add column if not exists feed_uid text,
  add column if not exists feed_occurrence text,
  add column if not exists feed_title text,
  add column if not exists feed_starts_on date,
  add column if not exists feed_starts_at timestamptz;

alter table todo.task_links drop constraint if exists task_links_exactly_one_ck;
alter table todo.task_links add constraint task_links_exactly_one_ck check (
  num_nonnulls(application_id, role_id, company_id, contact_id, interview_id,
               note_id, order_id, inventory_item_id, saved_item_id, reading_id,
               track_id, subject_id, goal_id, feed_id) = 1
);

-- The appointment's columns come together or not at all: a link with a feed
-- and no UID cannot be matched to anything, and one with no saved name has
-- nothing to show once the meeting is cancelled. The limits are feed_events'
-- own, since the values are copied from there.
alter table todo.task_links drop constraint if exists task_links_appointment_ck;
alter table todo.task_links add constraint task_links_appointment_ck check (
  (feed_id is null
   and num_nonnulls(feed_uid, feed_occurrence, feed_title, feed_starts_on, feed_starts_at) = 0)
  or
  (feed_id is not null
   and feed_uid is not null and btrim(feed_uid) <> '' and length(feed_uid) <= 500
   and feed_title is not null and btrim(feed_title) <> '' and length(feed_title) <= 500
   and (feed_occurrence is null or (btrim(feed_occurrence) <> '' and length(feed_occurrence) <= 40))
   and num_nonnulls(feed_starts_on, feed_starts_at) = 1)
);

-- The reverse read, "the open tasks about this meeting", which the opened
-- appointment's card makes (#1374), and the cascade from calendar_feeds.
create index if not exists task_links_feed_idx
  on todo.task_links (feed_id, feed_uid, feed_occurrence) where feed_id is not null;

-- ---------------------------------------------------------------------------
-- The ownership check, over fourteen targets. Unchanged from 0062 but for the
-- feed arm: the key to calendar_feeds is satisfied by any subscription in the
-- table, including another account's, because Postgres performs referential
-- integrity checks bypassing row level security.
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
                  new.goal_id, new.feed_id) <> 1 then
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
    when new.feed_id is not null then
      (select user_id from todo.calendar_feeds where id = new.feed_id)
  end into owner;

  if owner is null or task_owner is null or owner <> task_owner then
    raise exception 'a task link must point at something the task''s owner owns';
  end if;

  return new;
end;
$$;

revoke all on function todo.task_link_target_is_owned() from public, anon, authenticated;

comment on column todo.task_links.feed_id is
  'The subscription a task''s appointment comes from (plan #1373). The '
  'appointment itself is (feed_uid, feed_occurrence), matched against '
  'todo.feed_events each time the page draws, because those rows are '
  'rewritten on every refresh.';
comment on column todo.task_links.feed_title is
  'The appointment''s name when it was linked, shown once no copy matches.';

notify pgrst, 'reload schema';
