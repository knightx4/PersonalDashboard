-- One explain prompt per graded course, and the tested marks its answer
-- leaves in place of the course's band (plan #2172.4.2).
--
-- A course named for its topics (0157) marks each as "likely level 1 to N".
-- The course row on You's Work & school tab offers one explain prompt about
-- the course. The answer is graded against the levels 1 to 3 of every topic
-- the course was named for (lib/learn/evidence/course-explain.ts), and on
-- each topic the answer reached the band gives way to the level it showed.
--
-- 1. learn.course_explains
--
-- One row per course, written once when the answer is graded: the question,
-- the topics it was graded against, the answer, the grader's verdicts and the
-- marks they made. `marks` is [{"topic_id", "level", "quote", "basis"}]:
-- level 1 to 3 is the highest level the answer showed on that topic, and 0 a
-- topic the answer tried and fell short on. A topic the answer did not go to
-- has no mark and keeps its band. What each answer showed is read through
-- evidence_links, so not a source (as cell_questions is not).
--
-- 2. tested_level on learn.evidence_links
--
-- Set on a course's link to a topic once the answer marked it, with the band
-- cleared. A topic marked 0 loses the course's link: the band was a guess
-- the answer did not bear out.
--
-- 3. learn.apply_course_explain(course)
--
-- Puts one course's marks onto its links for the person signed in. The daily
-- band stage (course-band-store.ts) writes the same rows from the same marks
-- under the service role, so the two never disagree.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The answer to each course's explain prompt.
-- ---------------------------------------------------------------------------
create table if not exists learn.course_explains (
  course_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  -- [{"id": "<area_check_articles id>", "title": "Private equity"}, ...]
  topics jsonb not null default '[]'::jsonb,
  response text not null,
  grade jsonb not null default '[]'::jsonb,
  marks jsonb not null default '[]'::jsonb,
  model text not null,
  answered_at timestamptz not null default now(),
  constraint course_explains_topics_ck check (jsonb_typeof(topics) = 'array'),
  constraint course_explains_marks_ck check (jsonb_typeof(marks) = 'array'),
  constraint course_explains_response_ck check (length(btrim(response)) between 1 and 8000)
);

do $$
declare
  courses regclass := coalesce(to_regclass('you.courses'), to_regclass('obsidian.courses'));
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'learn.course_explains'::regclass and conname = 'course_explains_course_fk'
  ) then
    execute format(
      'alter table learn.course_explains add constraint course_explains_course_fk '
      'foreign key (course_id, user_id) references %s (id, user_id) on delete cascade',
      courses);
  end if;
end;
$$;

create index if not exists course_explains_user_idx on learn.course_explains (user_id);

alter table learn.course_explains enable row level security;
grant select, insert on learn.course_explains to authenticated;
grant select, insert, update, delete on learn.course_explains to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'course_explains' and policyname = 'course_explains_read'
  ) then
    create policy course_explains_read on learn.course_explains for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'course_explains' and policyname = 'course_explains_insert'
  ) then
    create policy course_explains_insert on learn.course_explains for insert to authenticated
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

comment on table learn.course_explains is
  'The one explain prompt answered about each graded course, its grade and the tested marks it left on the course''s topics (plan #2172.4.2). Written once; the marks are on evidence_links as tested_level.';

-- ---------------------------------------------------------------------------
-- 2. The tested level on a course's link to a topic.
-- ---------------------------------------------------------------------------
alter table learn.evidence_links add column if not exists tested_level smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'learn.evidence_links'::regclass and conname = 'evidence_links_tested_ck'
  ) then
    alter table learn.evidence_links add constraint evidence_links_tested_ck check (
      tested_level is null
      or (source_kind = 'course' and target_kind = 'topic'
          and band_low is null and band_high is null
          and tested_level between 1 and 10)
    );
  end if;
end;
$$;

comment on column learn.evidence_links.tested_level is
  'On a course link to a topic its explain prompt marked: the level the answer showed, in place of the band (plan #2172.4.2). Null on every other link.';

-- ---------------------------------------------------------------------------
-- 3. Putting one course's marks onto its links.
-- ---------------------------------------------------------------------------
create or replace function learn.apply_course_explain(p_course_id uuid)
returns integer
language plpgsql
security definer
set search_path = learn, public
as $$
declare
  v_user uuid := auth.uid();
  v_marks jsonb;
  v_changed integer := 0;
  v_rows integer;
  m jsonb;
begin
  if v_user is null then
    raise exception 'Sign in first.';
  end if;
  select marks into v_marks from learn.course_explains
   where course_id = p_course_id and user_id = v_user;
  if v_marks is null then
    return 0;
  end if;
  for m in select * from jsonb_array_elements(v_marks) loop
    if coalesce((m->>'level')::int, 0) >= 1 then
      update learn.evidence_links
         set band_low = null, band_high = null,
             tested_level = least((m->>'level')::int, 10),
             basis = coalesce(m->>'basis', basis)
       where user_id = v_user and target_kind = 'topic' and source_kind = 'course'
         and source_id = p_course_id::text and target_id = (m->>'topic_id')::uuid;
    else
      delete from learn.evidence_links
       where user_id = v_user and target_kind = 'topic' and source_kind = 'course'
         and source_id = p_course_id::text and target_id = (m->>'topic_id')::uuid;
    end if;
    get diagnostics v_rows = row_count;
    v_changed := v_changed + v_rows;
  end loop;
  return v_changed;
end;
$$;

revoke all on function learn.apply_course_explain(uuid) from public, anon;
grant execute on function learn.apply_course_explain(uuid) to authenticated, service_role;
