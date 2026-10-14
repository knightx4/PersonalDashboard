-- Courses you have taken as evidence for ideas (plan #2006.4).
--
-- Each course on a transcript (you.courses) is given a text and a vector, so
-- the daily run can link the ideas a course covers to it in
-- learn.evidence_links (0121), weighted by the grade and by how long ago the
-- course was.
--
-- 1. learn.course_sources(user)
--
-- What there is to say about each course: the course row, the notes that
-- belong to it and a catalogue description where one has the same title. A
-- note belongs to a course when its frontmatter `course` starts with the
-- course's code ("MGT 541 - Corporate Finance"), or when it is a course
-- summary (a note under "Course Summaries/") whose title starts with the
-- code, or whose title has no code and whose opening names it. The summary
-- comes first. A catalogue course matches when its title,
-- less a leading course number and a trailing term, is the course's title
-- letter for letter. lib/learn/evidence/courses.ts puts these together into
-- the text that is embedded. learn.course_notes is the rule for which notes
-- belong, and the matching below reads it too.
--
-- 2. learn.course_embeddings
--
-- One row per course with the text it was embedded from and its vector.
-- title_only is true when the course had neither notes nor a catalogue
-- description, and such a course is matched at a stricter threshold, since a
-- bare title like "Princ of Microeconomics" says little. Worked out from what
-- the person wrote rather than written by them, so not a source. A course
-- removed from the transcript takes its row with it.
--
-- 3. learn.course_idea_matches(user, ...)
--
-- The ideas each course covers, at or above the threshold for its
-- kind, the closest few per course and the closest few courses per idea.
-- A course with notes is as close to an idea as the closest of its own
-- vector and its notes' passages (obsidian.note_blocks, embedded by the vault
-- with the same model): a whole course summary is never as close to a
-- one-sentence idea as the paragraph that teaches it, and on the live data
-- no summary reached 0.6 against any idea while its passages did. A course
-- known by its title alone has only its own vector. The run turns these into
-- evidence links with a weight and a basis.

set search_path = learn, public, extensions;

-- The courses moved from obsidian to you in you 0004, which the local test
-- database applies after this file. A SQL function's body is looked up when it
-- runs, so the functions below read you.courses wherever they are created, and
-- the foreign key further down names whichever table exists now: it follows
-- the table when it moves.
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. What there is to say about each course.
-- ---------------------------------------------------------------------------

-- The notes that belong to each course, one row per course and note.
create or replace function learn.course_notes(p_user_id uuid)
returns table (course_id uuid, note_id uuid, body text, is_summary boolean, path text)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  with courses as (
    select c.id,
           -- The code as a pattern: "MGT 541" matches "MGT 541" and "MGT541",
           -- and stops at a word end so MGT 54 does not match MGT 541.
           regexp_replace(
             regexp_replace(btrim(c.code), '([^A-Za-z0-9 ])', '\\\1', 'g'),
             '\s+', '\\s*', 'g') || '\M' as code_re
    from you.courses c
    where c.user_id = p_user_id
      and c.code is not null and btrim(c.code) <> ''
  ),
  notes as (
    select n.id, n.path, n.title, n.body, n.frontmatter->>'course' as course_tag,
           n.path ilike '%Course Summaries/%' as is_summary
    from obsidian.notes n
    where n.user_id = p_user_id
      and n.deleted_at is null
      and btrim(coalesce(n.body, '')) <> ''
      and (n.frontmatter ? 'course' or n.path ilike '%Course Summaries/%')
      and n.title not like '\_%'
  )
  select c.id, n.id, n.body, n.is_summary, n.path
  from courses c
  join notes n
    on n.course_tag ~* ('^\s*' || c.code_re)
    or (n.is_summary and n.title ~* ('^\s*' || c.code_re))
    -- A summary whose title has no code of its own ("MGT - Strategic
    -- Leadership Across Sectors") is matched by the code in its opening; one
    -- titled with another course's code is not, though it may mention this
    -- one.
    or (n.is_summary and n.title !~ '^\s*[A-Za-z]{2,}\s*[0-9]'
        and left(n.body, 1200) ~* ('\m' || c.code_re));
$$;

revoke all on function learn.course_notes(uuid) from public, anon, authenticated;
grant execute on function learn.course_notes(uuid) to service_role;

create or replace function learn.course_sources(p_user_id uuid)
returns table (
  course_id uuid,
  school text,
  code text,
  title text,
  term text,
  year integer,
  grade text,
  notes text[],
  catalogue_description text
)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  with catalogue as (
    select lower(regexp_replace(
             regexp_replace(
               regexp_replace(i.title, '^[A-Z]{2,}[ ]+[A-Z0-9.]*[0-9][A-Z0-9.]*[ ]+', ''),
               ',\s*(Spring|Summer|Fall|Winter|Autumn)\s+[0-9]{4}\s*$', '', 'i'),
             '[^A-Za-z0-9]+', '', 'g')) as title_key,
           i.description
    from learn.catalogue_items i
    where i.kind = 'course'
      and i.description is not null
      and char_length(btrim(i.description)) >= 80
  ),
  course_notes as (
    select cn.course_id, array_agg(cn.body order by cn.is_summary desc, cn.path) as bodies
    from learn.course_notes(p_user_id) cn
    group by cn.course_id
  )
  select c.id, c.school, c.code, c.title, c.term, c.year, c.grade,
         coalesce(cn.bodies, '{}'::text[]),
         (
           select k.description
           from catalogue k
           where k.title_key <> ''
             and k.title_key = lower(regexp_replace(c.title, '[^A-Za-z0-9]+', '', 'g'))
           order by char_length(k.description) desc
           limit 1
         )
  from you.courses c
  left join course_notes cn on cn.course_id = c.id
  where c.user_id = p_user_id;
$$;

revoke all on function learn.course_sources(uuid) from public, anon, authenticated;
grant execute on function learn.course_sources(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Each course's text and vector.
-- ---------------------------------------------------------------------------
create table if not exists learn.course_embeddings (
  course_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  title_only boolean not null,
  embedding extensions.vector(1024),
  embedding_model text,
  embedded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint course_embeddings_text_ck check (text <> '')
);

do $$
declare
  courses regclass := coalesce(to_regclass('you.courses'), to_regclass('obsidian.courses'));
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'learn.course_embeddings'::regclass and conname = 'course_embeddings_course_fk'
  ) then
    execute format(
      'alter table learn.course_embeddings add constraint course_embeddings_course_fk '
      'foreign key (course_id, user_id) references %s (id, user_id) on delete cascade',
      courses);
  end if;
end;
$$;

create index if not exists course_embeddings_user_idx on learn.course_embeddings (user_id);

alter table learn.course_embeddings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'course_embeddings'
      and policyname = 'course_embeddings_read'
  ) then
    create policy course_embeddings_read on learn.course_embeddings for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.course_embeddings from anon, authenticated;
grant select on learn.course_embeddings to authenticated;
grant select, insert, update, delete on learn.course_embeddings to service_role;

comment on table learn.course_embeddings is
  'Each course on a transcript with the text it was embedded from (title, notes, catalogue description) and its vector, for linking ideas to courses (plan #2006.4).';

-- ---------------------------------------------------------------------------
-- 3. The ideas each course covers.
-- ---------------------------------------------------------------------------
create or replace function learn.course_idea_matches(
  p_user_id uuid,
  p_min_similarity real default 0.6,
  p_min_similarity_title_only real default 0.7,
  p_per_course integer default 30,
  p_per_idea integer default 5
)
returns table (course_id uuid, concept_id uuid, similarity real)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  with vectors as (
    -- The course's own vector.
    select e.course_id, e.title_only, e.embedding, e.embedding_model
    from learn.course_embeddings e
    where e.user_id = p_user_id and e.embedding is not null
    union all
    -- Its notes' passages, which count before the course has a vector of
    -- its own. A course with notes is never title only.
    select cn.course_id, false, b.embedding, b.embedding_model
    from learn.course_notes(p_user_id) cn
    join obsidian.note_blocks b on b.user_id = p_user_id and b.note_id = cn.note_id
    where b.embedding is not null
  ),
  pairs as (
    select v.course_id, k.id as concept_id,
           max(1 - (v.embedding <=> k.embedding))::real as similarity,
           bool_and(v.title_only) as title_only
    from vectors v
    join learn.concepts k
      on k.user_id = p_user_id and k.embedding is not null
     and k.embedding_model = v.embedding_model
    group by v.course_id, k.id
  ),
  kept as (
    select p.*,
           row_number() over (partition by p.course_id order by p.similarity desc, p.concept_id) as course_rank,
           row_number() over (partition by p.concept_id order by p.similarity desc, p.course_id) as idea_rank
    from pairs p
    where p.similarity >= case when p.title_only then p_min_similarity_title_only
                               else p_min_similarity end
  )
  select k.course_id, k.concept_id, least(k.similarity, 1)::real
  from kept k
  where k.course_rank <= p_per_course and k.idea_rank <= p_per_idea;
$$;

revoke all on function learn.course_idea_matches(uuid, real, real, integer, integer)
  from public, anon, authenticated;
grant execute on function learn.course_idea_matches(uuid, real, real, integer, integer)
  to service_role;
