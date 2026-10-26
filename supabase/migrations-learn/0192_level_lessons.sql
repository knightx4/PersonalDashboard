-- The lesson that teaches one level of a topic (plan #2546.5).
--
--   learn.level_lessons
--       One row per person per topic level (cell_id, a learn.topic_cells
--       row): the short lesson the session shows before that level's first
--       question, for topics no plan piece teaches, such as the business
--       pack. Written once, by one Sonnet call from the level's checks and
--       the closest catalogue section (lib/learn/levels/level-lesson.ts),
--       and read from here every time after, so opening the level again
--       costs nothing.
--
--       The parts are a lesson card's, under the column names
--       learn.feed_cards gives them, so one reader turns either into a
--       lesson. status is ready, or dropped when the writer would not
--       teach it, with drop_reason; a dropped row is kept so it is not paid
--       for again. read_at is when the person was first shown it; the
--       session serves an unread one ahead of the level's first question.
--       Lessons are written only with the service role, as lesson cards
--       are; the person's own session reads its rows and sets read_at.
--
-- Bookkeeping, not a source: what the person showed they know is in
-- learn.cell_evidence.

set search_path = learn, public, extensions;

create table if not exists learn.level_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cell_id uuid not null references learn.topic_cells (id) on delete cascade,
  topic_id uuid not null references learn.topics (id) on delete cascade,
  level smallint not null check (level between 1 and 10),
  status text not null check (status in ('ready', 'dropped')),
  takeaway text,
  context text,
  hook text,
  summary text,
  example text,
  check_question text,
  check_answer text,
  predict_question text,
  predict_answer text,
  figures jsonb not null default '[]'::jsonb,
  source_item_id uuid,
  source_segment_id uuid,
  drop_reason text,
  write_model text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint level_lessons_user_cell_key unique (user_id, cell_id),
  constraint level_lessons_ready_ck check (status <> 'ready' or takeaway is not null),
  constraint level_lessons_dropped_ck check (status <> 'dropped' or drop_reason is not null)
);

create index if not exists level_lessons_cell_idx on learn.level_lessons (cell_id);
create index if not exists level_lessons_topic_idx on learn.level_lessons (topic_id);

comment on table learn.level_lessons is
  'The lesson shown before a topic level''s first question, written once per person per level (plan #2546.5).';
comment on column learn.level_lessons.read_at is
  'When the person was first shown the lesson; null while it waits ahead of the level''s first question.';

alter table learn.level_lessons enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'level_lessons' and policyname = 'level_lessons_own'
  ) then
    create policy level_lessons_own on learn.level_lessons for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on table learn.level_lessons from authenticated;
grant select on learn.level_lessons to authenticated;
grant update (read_at) on learn.level_lessons to authenticated;
grant select, insert, update, delete on learn.level_lessons to service_role;
revoke all on table learn.level_lessons from anon;
