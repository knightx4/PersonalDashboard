-- A course's weeks, read from its syllabus (plan #2401.6, under #2401).
--
-- Pressing "Lay out the weeks" under a course's syllabus has Dash read the
-- syllabus once and list the course's weeks, each with its topic. They are
-- kept here, one row per week, so the course shows a slot for every week
-- before any file sits in it. A file joins a week through its own week
-- number (you.course_files.week); nothing here points at a file.
--
-- week is the week's number, 0 to 60 as on course_files. title is the
-- week's topic as the syllabus gives it, or null for a week it names
-- without one.
--
-- edited_at is set when the person changes a week's title by hand, and
-- removed_at when they remove the week. Reading the syllabus again leaves
-- both kinds of row as they are: an edited title is kept, and a removed week
-- stays removed rather than coming back. Every other row is rewritten from
-- the new read, and one the new read no longer names goes.
--
-- A week belongs to a course of the same owner and goes with it.

set search_path = you, public, extensions;

create table you.course_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null,
  week integer not null check (week between 0 and 60),
  title text check (title is null or (btrim(title) <> '' and char_length(title) <= 200)),
  edited_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint course_weeks_course_week_key unique (course_id, week),

  foreign key (course_id, user_id)
    references you.courses (id, user_id) on delete cascade
);

comment on table you.course_weeks is
  'The weeks of a course and the topic of each, read by Dash from its syllabus on a press; edited_at and removed_at mark weeks the person changed or removed, which a second read leaves alone (plan #2401.6).';

create index course_weeks_user_idx on you.course_weeks (user_id);

create trigger course_weeks_touch_updated_at
  before update on you.course_weeks
  for each row execute function you.touch_updated_at();

alter table you.course_weeks enable row level security;

create policy course_weeks_all on you.course_weeks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.course_weeks from anon, authenticated;
grant select, insert, update, delete on you.course_weeks to authenticated, service_role;

notify pgrst, 'reload schema';
