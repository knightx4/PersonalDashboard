-- Topics unlocked by what you wrote, studied or did (plan #2016.3).
--
-- A Level 4 topic appears on your map once one of your notes, courses, work
-- passages or ideas touches it. Each unlock is a row of learn.evidence_links
-- (learn 0121) with target_kind 'topic' and target_id the article in
-- learn.area_check_articles. The daily run decides which topics unlock
-- (lib/learn/evidence/topics.ts) from two kinds of finding:
--
--   a name     the topic's title or one of its other names appears in the
--              text as whole words;
--   a vector   the source's stored embedding is close to the topic's.
--
-- No model is called: the vectors are the ones already stored.
--
-- What this adds:
--
-- 1. 'idea' as a kind of source, since an idea of yours can unlock a topic.
-- 2. matched_by on each link: 'name' when the text names the topic,
--    'similarity' when the vectors agreed, null for the links to ideas, which
--    are all by vector.
-- 3. learn.topic_unlock_sources(user, kind): the texts to look for names in,
--    one kind of source at a time, in a stable order so the run can page
--    through the notes.
-- 4. learn.topic_similarity_matches(user, ...): each source's nearest topics.
-- 5. learn.topic_pair_similarities(user, pairs): how close named pairs are,
--    so a name that is a common word is believed only where the text is also
--    about the topic.
--
-- The topics are embedded at 512 dimensions and the sources at 1,024 by the
-- same model, voyage-4-lite, which is trained so that the first 512 numbers
-- of its 1,024 are its 512-dimension vector. A source is compared with a
-- topic by those first 512 numbers.
--
-- you.courses is created after the learn migrations on a fresh database, so
-- the bodies are checked when they run rather than now.

set search_path = learn, public, extensions;
set check_function_bodies = off;

-- 1. An idea as a source.
alter table learn.evidence_links drop constraint if exists evidence_links_source_kind_ck;
alter table learn.evidence_links add constraint evidence_links_source_kind_ck
  check (source_kind in ('note', 'course', 'work', 'reading', 'video', 'idea'));

-- 2. How a link was found.
alter table learn.evidence_links add column if not exists matched_by text;
alter table learn.evidence_links drop constraint if exists evidence_links_matched_by_ck;
alter table learn.evidence_links add constraint evidence_links_matched_by_ck
  check (matched_by is null or matched_by in ('name', 'similarity'));

comment on column learn.evidence_links.matched_by is
  'For a link to a topic: name when the source''s text names the topic, similarity when the vectors agreed (plan #2016.3). Null for links to ideas.';

-- 3. The texts. One row per source of the kind asked for:
--   note    title and body of each vault note, less deleted notes,
--           templates and CLAUDE.md or AGENTS.md; detail is the path.
--   course  each transcript course; body is its title, detail its code.
--   work    each passage of the résumé and Career notes; document_id is the
--           résumé or note it came from, detail its first line.
--   idea    each idea's name and claim.
create or replace function learn.topic_unlock_sources(p_user_id uuid, p_kind text)
returns table (
  source_id text,
  document_id text,
  title text,
  body text,
  detail text,
  created_at timestamptz,
  written_at timestamptz,
  grade text,
  year integer,
  origin text,
  weight real
)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  select n.id::text, n.id::text, n.title, n.body, n.path, n.created_at, n.written_at,
         null::text, null::integer, null::text, null::real
    from obsidian.notes n
   where p_kind = 'note'
     and n.user_id = p_user_id
     and n.deleted_at is null
     and n.path !~* '(^|/)templates/'
     and n.path !~* '(^|/)(claude|agents)\.md$'
  union all
  select c.id::text, c.id::text, c.title, c.title, c.code, null, null,
         c.grade, c.year, null, null
    from you.courses c
   where p_kind = 'course' and c.user_id = p_user_id and btrim(coalesce(c.title, '')) <> ''
  union all
  select w.id::text, w.source_id::text, w.source_title, w.body, w.first_line, null, null,
         null, null, w.origin, w.weight
    from learn.work_passages w
   where p_kind = 'work' and w.user_id = p_user_id
  union all
  select c.id::text, c.id::text, c.name, concat_ws(E'\n', c.name, c.claim), null, null, null,
         null, null, null, null
    from learn.concepts c
   where p_kind = 'idea' and c.user_id = p_user_id
  order by 1
$$;

-- The vectors of every source, cut to the topics' 512 dimensions. Only
-- vectors made by the model that made the topics' are compared.
create or replace function learn.topic_source_vectors(p_user_id uuid)
returns table (source_kind text, source_id text, embedding extensions.vector(512))
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  with model as (
    select max(embedding_model) as name from learn.area_check_articles where embedding is not null
  )
  select 'note', e.note_id::text, extensions.subvector(e.embedding, 1, 512)::extensions.vector(512)
    from obsidian.note_embeddings e
    join obsidian.notes n on n.id = e.note_id
    cross join model
   where e.user_id = p_user_id and e.embedding_model = model.name
     and n.deleted_at is null
     and n.path !~* '(^|/)templates/'
     and n.path !~* '(^|/)(claude|agents)\.md$'
  union all
  select 'course', e.course_id::text, extensions.subvector(e.embedding, 1, 512)::extensions.vector(512)
    from learn.course_embeddings e cross join model
   where e.user_id = p_user_id and e.embedding is not null and e.embedding_model = model.name
  union all
  select 'work', w.id::text, extensions.subvector(w.embedding, 1, 512)::extensions.vector(512)
    from learn.work_passages w cross join model
   where w.user_id = p_user_id and w.embedding is not null and w.embedding_model = model.name
  union all
  select 'idea', c.id::text, extensions.subvector(c.embedding, 1, 512)::extensions.vector(512)
    from learn.concepts c cross join model
   where c.user_id = p_user_id and c.embedding is not null and c.embedding_model = model.name
$$;

-- 4. Each source's p_per_source nearest topics at p_min_similarity or above,
-- through the topics' vector index: about 2,500 sources, five lookups each.
create or replace function learn.topic_similarity_matches(
  p_user_id uuid,
  p_per_source integer default 5,
  p_min_similarity real default 0.55
)
returns table (source_kind text, source_id text, topic_id uuid, similarity real)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  select s.source_kind, s.source_id, near.id, near.similarity
    from learn.topic_source_vectors(p_user_id) s
   cross join lateral (
     select a.id, (1 - (a.embedding <=> s.embedding))::real as similarity
       from learn.area_check_articles a
      order by a.embedding <=> s.embedding
      limit greatest(p_per_source, 1)
   ) near
   where near.similarity >= p_min_similarity
$$;

-- 5. How close each named pair is. p_pairs is a JSON array of
-- {"k": source kind, "s": source id, "t": topic id}; a pair whose source has
-- no vector from the topics' model is left out.
create or replace function learn.topic_pair_similarities(p_user_id uuid, p_pairs jsonb)
returns table (source_kind text, source_id text, topic_id uuid, similarity real)
language sql
stable
security invoker
set search_path = learn, public, extensions
as $$
  with pairs as (
    select p ->> 'k' as kind, p ->> 's' as sid, (p ->> 't')::uuid as tid
      from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) as p
  )
  select p.kind, p.sid, p.tid, (1 - (v.embedding <=> a.embedding))::real
    from pairs p
    join learn.topic_source_vectors(p_user_id) v on v.source_kind = p.kind and v.source_id = p.sid
    join learn.area_check_articles a on a.id = p.tid
   where a.embedding is not null
$$;

revoke all on function learn.topic_unlock_sources(uuid, text) from public, anon, authenticated;
grant execute on function learn.topic_unlock_sources(uuid, text) to service_role;
revoke all on function learn.topic_source_vectors(uuid) from public, anon, authenticated;
grant execute on function learn.topic_source_vectors(uuid) to service_role;
revoke all on function learn.topic_similarity_matches(uuid, integer, real) from public, anon, authenticated;
grant execute on function learn.topic_similarity_matches(uuid, integer, real) to service_role;
revoke all on function learn.topic_pair_similarities(uuid, jsonb) from public, anon, authenticated;
grant execute on function learn.topic_pair_similarities(uuid, jsonb) to service_role;

comment on function learn.topic_similarity_matches(uuid, integer, real) is
  'Each note, course, work passage and idea''s nearest Level 3 and 4 topics, for unlocking topics (plan #2016.3).';
