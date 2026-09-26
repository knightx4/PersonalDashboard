-- Leave templates and instruction files out of the related-notes lookup
-- (plan #1114, under #1110).
--
-- The second thing checking the goal pages against the live vault turned up,
-- after the stubs (0023): the vault's CLAUDE.md, which tells an assistant how
-- to work on application files, came out nearest the goal "Walk into
-- interviews ready" at 0.64. It is instructions for a tool, not something the
-- person wrote about a subject. Templates are the same kind of file: the
-- skeleton of a note rather than a note, and one of them (Stocks Template) is
-- long enough to pass the stub test.
--
-- So nearest_notes skips any note in a folder named Templates, at any depth,
-- and any file named CLAUDE.md or AGENTS.md. Both tests are on the path, which
-- is short, so they sit in the scan's own filter rather than beside the body
-- check. Everything else is as 0023 left it.

set search_path = obsidian, public, extensions;

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
             and n.path !~* '(^|/)templates/'
             and n.path !~* '(^|/)(claude|agents)\.md$'
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
  'Live vault notes with something written in them, templates and instruction files aside, nearest a query vector by cosine similarity, closest first, above min_similarity.';

revoke all on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  from public, anon;
grant execute on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  to authenticated, service_role;
