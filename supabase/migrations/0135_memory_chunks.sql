-- Passages of what the person wrote or did, each with a meaning vector, and
-- the search over them (plan #1246, under #1245).
--
-- Feature #1245 lets Ask Dash find a note, a thoughts entry or a goal step by
-- what it is about rather than by the words it shares with the question. The
-- only vectors of the person's writing so far are one per whole vault note
-- (obsidian.note_embeddings), which is too coarse to point at one paragraph of
-- a long note. This adds one row per passage of a source row, across every
-- module, in one table: the search runs across everything at once, and one
-- person's passages are a single exact scan.
--
-- core.memory_chunks, one row per passage:
--   source_table     the row's table, schema-qualified as the sources
--                    catalogue names it ('obsidian.notes', 'job_search.thoughts').
--   source_ref       the row's key as text, as the catalogue's ref column
--                    gives it (an id for most tables, a year or a week for a
--                    few), so one column serves every table.
--   chunk_index      the passage's place in the row, from 0.
--   author           'me' for the person's own words, 'dash' for text Dash
--                    wrote (goal step results, Dash's files, Learn cards), so
--                    an answer to "what did I say" can tell the two apart.
--   body             the passage as it was embedded.
--   source_hash      md5 of the whole row's text when the passages were cut.
--                    A row whose text now hashes differently is stale and is
--                    cut and embedded again (#1247); an unchanged one never is.
--   embedding        a Voyage vector, 1024 wide (lib/learn/embed, voyage-4-lite).
--   embedding_model  the model that made it, so a later model change can be
--                    told apart and searched separately.
--
-- The key is (user_id, source_table, source_ref, chunk_index). The owner is in
-- it because a few catalogue refs are not unique across people (a year, a
-- week), and one person's rewrite must never collide with another's rows.
--
-- No approximate index. A person has a few thousand passages, and an exact
-- scan filtered to their own rows returns the true nearest ones, where an
-- HNSW index over everyone's rows would filter after the approximate step and
-- could return fewer than asked. The index on (user_id, source_table) is what
-- narrows the scan to one person.
--
-- Bookkeeping, not a source: lib/core/sources.ts lists it under notSources.
-- The rows it points at are the sources.

set search_path = core, public, extensions;

create extension if not exists vector with schema extensions;

create table core.memory_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  source_table text not null,
  source_ref text not null,
  chunk_index int not null,
  author text not null,
  body text not null,
  source_hash text not null,
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  embedded_at timestamptz not null default now(),

  constraint memory_chunks_source_table_ck check (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  constraint memory_chunks_source_ref_ck check (btrim(source_ref) <> ''),
  constraint memory_chunks_chunk_index_ck check (chunk_index >= 0),
  constraint memory_chunks_author_ck check (author in ('me', 'dash')),
  constraint memory_chunks_body_ck check (btrim(body) <> ''),
  constraint memory_chunks_key unique (user_id, source_table, source_ref, chunk_index)
);

-- One person's passages, optionally narrowed to some tables: the scan's filter.
create index memory_chunks_user_source_idx on core.memory_chunks (user_id, source_table);

alter table core.memory_chunks enable row level security;

create policy memory_chunks_all on core.memory_chunks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on core.memory_chunks from anon;
grant select, insert, update, delete on core.memory_chunks to authenticated;
grant all on core.memory_chunks to service_role;

comment on table core.memory_chunks is
  'One Voyage vector per passage of a source row, across modules, for search by meaning (plan #1246).';
comment on column core.memory_chunks.author is
  'me: the person wrote it. dash: Dash wrote it.';
comment on column core.memory_chunks.source_hash is
  'md5 of the whole source row''s text when its passages were cut; a different hash now means stale.';

-- ---------------------------------------------------------------------------
-- Search by a query vector.
--
-- Built like obsidian.nearest_notes: the vector literal is parsed once in a
-- materialized CTE, and the scan is exact. `p_user_id` is required and always
-- filtered on: null returns nothing, never everyone's rows. The service role
-- bypasses RLS, so this filter is what keeps one person's search to their
-- own passages there; a signed-in caller is held to their own rows by RLS as
-- well.
--
-- `p_sources` narrows to some tables ('obsidian.notes', ...); null is all of
-- them. `p_authors` narrows to 'me' or 'dash'; null is both. Closest first,
-- above `min_similarity` (cosine, 1 is identical), at most 50.
-- ---------------------------------------------------------------------------
create or replace function core.search_memory(
  query_embedding text,
  p_user_id uuid,
  p_sources text[] default null,
  match_limit int default 10,
  min_similarity double precision default 0,
  embedding_model_filter text default null,
  p_authors text[] default null
)
returns table (
  id uuid,
  source_table text,
  source_ref text,
  chunk_index int,
  author text,
  body text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = core, extensions, pg_temp
as $$
  with query as materialized (
    select query_embedding::extensions.vector as v
  ),
  wanted as materialized (
    select least(greatest(coalesce(match_limit, 10), 1), 50) as k
  )
  select near.id, near.source_table, near.source_ref, near.chunk_index, near.author,
         near.body, (1 - near.distance)::double precision
    from (
      select c.id, c.source_table, c.source_ref, c.chunk_index, c.author, c.body,
             c.embedding <=> query.v as distance
        from query
       cross join core.memory_chunks c
       where c.user_id = p_user_id
         and (p_sources is null or c.source_table = any (p_sources))
         and (p_authors is null or c.author = any (p_authors))
         and (embedding_model_filter is null or c.embedding_model = embedding_model_filter)
       order by (c.embedding <=> query.v) + 0
       limit (select k from wanted)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.source_table, near.source_ref, near.chunk_index
$$;

comment on function core.search_memory(text, uuid, text[], int, double precision, text, text[]) is
  'One person''s passages nearest a query vector by cosine similarity, closest first, above min_similarity (plan #1246).';

-- ---------------------------------------------------------------------------
-- Search from a row already found.
--
-- The goals routine (#1250) starts from a row it has in hand and wants what
-- else the person wrote that bears on it, without embedding a query. This
-- uses that row's own passages as the query: each other passage scores its
-- best cosine against any of them, and the row's own passages are left out.
-- Only passages made by the same model as the row's are compared. A row with
-- no passages yet returns nothing. The owner is required and filtered on, as
-- in search_memory.
-- ---------------------------------------------------------------------------
create or replace function core.search_memory_from(
  p_user_id uuid,
  p_source_table text,
  p_source_ref text,
  p_sources text[] default null,
  match_limit int default 10,
  min_similarity double precision default 0,
  p_authors text[] default null
)
returns table (
  id uuid,
  source_table text,
  source_ref text,
  chunk_index int,
  author text,
  body text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = core, extensions, pg_temp
as $$
  with origin as materialized (
    select o.embedding, o.embedding_model
      from core.memory_chunks o
     where o.user_id = p_user_id
       and o.source_table = p_source_table
       and o.source_ref = p_source_ref
  ),
  wanted as materialized (
    select least(greatest(coalesce(match_limit, 10), 1), 50) as k
  )
  select near.id, near.source_table, near.source_ref, near.chunk_index, near.author,
         near.body, (1 - near.distance)::double precision
    from (
      select c.id, c.source_table, c.source_ref, c.chunk_index, c.author, c.body,
             min(c.embedding <=> o.embedding) as distance
        from core.memory_chunks c
        join origin o on o.embedding_model = c.embedding_model
       where c.user_id = p_user_id
         and not (c.source_table = p_source_table and c.source_ref = p_source_ref)
         and (p_sources is null or c.source_table = any (p_sources))
         and (p_authors is null or c.author = any (p_authors))
       group by c.id, c.source_table, c.source_ref, c.chunk_index, c.author, c.body
       order by min(c.embedding <=> o.embedding)
       limit (select k from wanted)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.source_table, near.source_ref, near.chunk_index
$$;

comment on function core.search_memory_from(uuid, text, text, text[], int, double precision, text[]) is
  'One person''s passages nearest any passage of a given row, the row itself left out, closest first (plan #1246).';

revoke all on function core.search_memory(text, uuid, text[], int, double precision, text, text[])
  from public, anon;
revoke all on function core.search_memory_from(uuid, text, text, text[], int, double precision, text[])
  from public, anon;
grant execute on function core.search_memory(text, uuid, text[], int, double precision, text, text[])
  to authenticated, service_role;
grant execute on function core.search_memory_from(uuid, text, text, text[], int, double precision, text[])
  to authenticated, service_role;
