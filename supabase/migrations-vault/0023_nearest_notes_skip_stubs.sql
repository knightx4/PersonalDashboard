-- Leave notes with nothing written in them out of the related-notes lookup
-- (plan #1114, under #1110).
--
-- Checking the job and goal pages against the live vault turned up matches
-- well above the threshold that were plainly wrong: a pursuit at Google found
-- a note called "Tech" at 0.67, and one at Maybell Quantum found "simulated
-- companies" at 0.66. Every one of them was a stub. Of the 1,288 notes, 51
-- have an empty body and 25 more hold only links, tags or a word or two, so
-- their vector is the vector of their title alone. A short text,
-- such as a company name and a role, sits close to a bare title whatever the
-- subject, and a stub opens onto nothing worth reading.
--
-- obsidian.note_prose_chars counts what is left of a body once wiki links,
-- tags, markdown punctuation and whitespace are taken out. Below 20 the note
-- is a stub: that drops the empty and link-only notes and keeps short real
-- ones such as a two-line thought on AI (59) or a definition of NLP (28).
--
-- nearest_notes keeps its signature and its exact scan (0022). It now takes
-- the nearest match_limit + 20, drops the stubs among them, and keeps the
-- nearest match_limit of the rest, so the count of body checks is small and
-- fixed instead of one per note. Fewer than 20 stubs among the nearest is
-- all but certain at a stub rate of one note in seventeen; when it fails, the
-- caller gets fewer notes, never a stub.

set search_path = obsidian, public, extensions;

create or replace function obsidian.note_prose_chars(body text)
returns int
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select length(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(body, ''), '!?\[\[[^\]]*\]\]', '', 'g'),
        '(^|\s)#[[:alnum:]_/-]+', ' ', 'g'
      ),
      '[[:space:]#>*_`~=|\[\]()-]+', '', 'g'
    )
  )
$$;

comment on function obsidian.note_prose_chars(text) is
  'Characters of a note body left once links, tags, markdown punctuation and whitespace are removed (plan #1114).';

revoke all on function obsidian.note_prose_chars(text) from public, anon;
grant execute on function obsidian.note_prose_chars(text) to authenticated, service_role;

create or replace function obsidian.nearest_notes(
  query_embedding text,
  p_user_id uuid default null,
  match_limit int default 2,
  min_similarity double precision default 0,
  embedding_model_filter text default null,
  p_exclude uuid[] default null
)
returns table (
  note_id uuid,
  path text,
  title text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with query as materialized (
    select query_embedding::extensions.vector as v
  ),
  wanted as materialized (
    select least(greatest(coalesce(match_limit, 2), 1), 50) as k
  )
  select near.note_id, near.path, near.title, (1 - near.distance)::double precision
    from (
      select candidate.*
        from (
          select e.note_id,
                 n.path,
                 n.title,
                 e.embedding <=> query.v as distance
            from query
           cross join obsidian.note_embeddings e
            join obsidian.notes n on n.id = e.note_id
           where n.deleted_at is null
             and (p_user_id is null or e.user_id = p_user_id)
             and (embedding_model_filter is null or e.embedding_model = embedding_model_filter)
             and (p_exclude is null or e.note_id <> all (p_exclude))
           order by (e.embedding <=> query.v) + 0
           limit (select k + 20 from wanted)
        ) candidate
        -- The body is read only for the candidates, not carried through the
        -- sort of every note.
        join obsidian.notes body_of on body_of.id = candidate.note_id
       where obsidian.note_prose_chars(body_of.body) >= 20
       order by candidate.distance
       limit (select k from wanted)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.path
$$;

comment on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[]) is
  'Live vault notes with something written in them nearest a query vector by cosine similarity, closest first, above min_similarity.';

revoke all on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  from public, anon;
grant execute on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  to authenticated, service_role;
