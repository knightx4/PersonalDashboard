-- Course digests (docs/LEARN-DIGEST-SPEC.md).
--
--   learn.courses
--       One row per lecture series the person has, or has asked for, cut down
--       to what they need. `digest` is the whole digest as one document
--       (lib/learn/courses/digest.ts says its shape and checks it): the
--       lessons, the dependencies, where the series disagrees with itself,
--       a rating for every lecture, the big ideas, the timed path and the
--       lecturers' errors. Ratings and treatments depend on the person, so
--       they live here and never on the lectures (rule D3).
--
--       A course is built by a Claude Code routine, not the API
--       (.claude/skills/learn-courses/SKILL.md). The app writes a row with
--       status `queued` and fires the routine; the session takes it
--       (`building`), reports each stage in `steps` so the page can show
--       where it is, and saves the digest through scripts/learn-course.ts
--       (`ready`), or gives up saying why (`failed`).
--
--       `steps` is a list of {key, label, state, detail, at}. `progress` is
--       what the person has done with it: path clips watched and lessons
--       finished.
--
--   learn.course_lectures
--       The series' videos in order, each with the notes file the session
--       wrote from its whole transcript. The notes are the durable middle of
--       the build: everything after them reads the notes, not the
--       transcripts, and a rebuild for a new goal starts from them.

set search_path = learn, public, extensions;

create table if not exists learn.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  provider text,
  source_url text,
  about text,
  goal text,
  budget_minutes integer not null default 180,
  catalogue_key text,
  status text not null default 'queued',
  steps jsonb not null default '[]'::jsonb,
  digest jsonb,
  totals jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  error text,
  run_url text,
  requested_at timestamptz not null default now(),
  taken_at timestamptz,
  built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_title_ck check (length(btrim(title)) between 1 and 300),
  constraint courses_status_ck check (status in ('queued', 'building', 'ready', 'failed')),
  constraint courses_budget_ck check (budget_minutes between 15 and 1200),
  constraint courses_ready_ck check (status <> 'ready' or digest is not null)
);

create unique index if not exists courses_catalogue_uq
  on learn.courses (user_id, catalogue_key)
  where catalogue_key is not null;

create index if not exists courses_user_status_idx on learn.courses (user_id, status, requested_at);

create table if not exists learn.course_lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references learn.courses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,
  position integer not null,
  title text not null,
  speaker text,
  video_id text not null,
  duration_seconds integer not null,
  notes text,
  noted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint course_lectures_code_uq unique (course_id, code),
  constraint course_lectures_video_uq unique (course_id, video_id),
  constraint course_lectures_duration_ck check (duration_seconds > 0)
);

create index if not exists course_lectures_user_idx on learn.course_lectures (user_id);

alter table learn.courses enable row level security;
alter table learn.course_lectures enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'learn' and tablename = 'courses' and policyname = 'courses_own'
  ) then
    create policy courses_own on learn.courses for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'learn' and tablename = 'course_lectures' and policyname = 'course_lectures_own'
  ) then
    create policy course_lectures_own on learn.course_lectures for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.courses from anon, authenticated;
revoke all on learn.course_lectures from anon, authenticated;
grant select, insert, update on learn.courses to authenticated;
grant select on learn.course_lectures to authenticated;
grant select, insert, update, delete on learn.courses to service_role;
grant select, insert, update, delete on learn.course_lectures to service_role;

comment on table learn.courses is
  'A lecture series cut down for one person: the digest, how its build is going, and what they have watched (docs/LEARN-DIGEST-SPEC.md).';
comment on column learn.courses.digest is
  'The whole digest as one document; lib/learn/courses/digest.ts gives its shape and checks it.';
comment on column learn.courses.steps is
  'The build''s stages as the routine reports them: {key, label, state, detail, at}.';
comment on table learn.course_lectures is
  'Bookkeeping: a course''s videos in order, each with the notes written from its whole transcript.';
