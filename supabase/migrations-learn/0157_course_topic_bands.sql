-- The topics each graded course covered, marked as a band of likely levels
-- (plan #2172.4.1, decision #2172.3).
--
-- A course on your transcript marks the frame topics it covered as "likely
-- level 1 to N". The top of the band is set by the course's depth (an
-- introductory course reaches 2 at most, an intermediate one 3, an advanced
-- or graduate one 4), times the grade and the fade of the years since, never
-- under 1 (lib/learn/evidence/course-bands.ts). The band is shown beside the
-- course on the topic page with the reason. It is not a tested level: an
-- explain prompt about the course (#2172.4.2) replaces it with points.
--
-- 1. learn.course_topics
--
-- One row per course: the depth and the topics one model call named from a
-- shortlist of the frame topics nearest the course's vector, and the text the
-- call read, so a course is named again only when that text changes.
-- `guessed` is true when the course had neither notes nor a catalogue
-- description, so the topics were guessed from its title alone. Worked out
-- from what the person wrote rather than written by them, so not a source.
--
-- 2. band_low and band_high on learn.evidence_links
--
-- Set only on a course's link to a topic that the call named. The topic
-- unlock stage leaves these rows alone and does not clear them.
--
-- 3. learn.course_topic_candidates(user, per_course)
--
-- The frame topics nearest each course's stored vector, the shortlist the
-- call chooses from.

set search_path = learn, public, extensions;
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. The topics each course was named for.
-- ---------------------------------------------------------------------------
create table if not exists learn.course_topics (
  course_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  depth text not null,
  guessed boolean not null,
  -- [{"id": "<area_check_articles id>", "similarity": 0.71}, ...]
  topics jsonb not null default '[]'::jsonb,
  text text not null,
  model text not null,
  named_at timestamptz not null default now(),
  constraint course_topics_depth_ck check (depth in ('intro', 'intermediate', 'advanced')),
  constraint course_topics_topics_ck check (jsonb_typeof(topics) = 'array')
);

do $$
declare
  courses regclass := coalesce(to_regclass('you.courses'), to_regclass('obsidian.courses'));
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'learn.course_topics'::regclass and conname = 'course_topics_course_fk'
  ) then
    execute format(
      'alter table learn.course_topics add constraint course_topics_course_fk '
      'foreign key (course_id, user_id) references %s (id, user_id) on delete cascade',
      courses);
  end if;
end;
$$;

create index if not exists course_topics_user_idx on learn.course_topics (user_id);

alter table learn.course_topics enable row level security;
grant select on learn.course_topics to authenticated;
grant select, insert, update, delete on learn.course_topics to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'course_topics'
      and policyname = 'course_topics_read'
  ) then
    create policy course_topics_read on learn.course_topics for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

comment on table learn.course_topics is
  'The frame topics one call named for each graded course, its depth, and whether the topics were guessed from the title alone (plan #2172.4.1). The daily run writes it; the links are in evidence_links with a band.';

-- ---------------------------------------------------------------------------
-- 2. The band on a course's link to a topic.
-- ---------------------------------------------------------------------------
alter table learn.evidence_links add column if not exists band_low smallint;
alter table learn.evidence_links add column if not exists band_high smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'learn.evidence_links'::regclass and conname = 'evidence_links_band_ck'
  ) then
    alter table learn.evidence_links add constraint evidence_links_band_ck check (
      (band_low is null and band_high is null)
      or (source_kind = 'course' and target_kind = 'topic'
          and band_low between 1 and 10 and band_high between band_low and 10)
    );
  end if;
end;
$$;

comment on column learn.evidence_links.band_low is
  'On a course link to a topic its call named: the lowest likely level (plan #2172.4.1). Null on every other link.';
comment on column learn.evidence_links.band_high is
  'On a course link to a topic its call named: the highest likely level, set by the course depth, the grade and the years since (plan #2172.4.1).';

-- ---------------------------------------------------------------------------
-- 3. The shortlist of frame topics nearest each course.
-- ---------------------------------------------------------------------------
create or replace function learn.course_topic_candidates(p_user_id uuid, p_per_course integer default 40)
returns table (course_id uuid, topic_id uuid, title text, level smallint, similarity real)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  -- The topics' vectors are the first 512 dimensions of the same model's, as
  -- in learn.topic_source_vectors (0129).
  with model as (
    select max(embedding_model) as name from learn.area_check_articles where embedding is not null
  ),
  courses as (
    select e.course_id, extensions.subvector(e.embedding, 1, 512)::extensions.vector(512) as embedding
      from learn.course_embeddings e cross join model
     where e.user_id = p_user_id and e.embedding is not null and e.embedding_model = model.name
  )
  select c.course_id, near.id, near.title, near.level, near.similarity
    from courses c
   cross join lateral (
     select a.id, a.title, a.level, (1 - (a.embedding <=> c.embedding))::real as similarity
       from learn.area_check_articles a
      where a.embedding is not null
      order by a.embedding <=> c.embedding
      limit greatest(p_per_course, 1)
   ) near;
$$;

revoke all on function learn.course_topic_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function learn.course_topic_candidates(uuid, integer) to service_role;
