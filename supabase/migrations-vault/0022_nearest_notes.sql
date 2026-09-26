-- The vault notes nearest any piece of text (plan #1112, under #1110).
--
-- Feature #1110 shows a person's own notes beside the news story, Learn card,
-- job or goal they relate to. #1111 gave every note a vector
-- (obsidian.note_embeddings); this is the lookup the pages share, and a cache
-- so the text a page asks about is embedded once rather than on every view.
--
-- lib/vault/notes/related.ts embeds the page's text, keeps the vector here by
-- the text's hash, and asks obsidian.nearest_notes for the notes above the
-- threshold it holds (RELATED_NOTE_MIN_SIMILARITY).

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- The notes nearest a vector.
--
-- Built like obsidian.nearest_themes (0010): an exact scan rather than a walk
-- of note_embeddings_embedding_idx, ordered by the distance plus zero to keep
-- the planner off the index. One person's vault is a couple of thousand notes,
-- and an HNSW walk that then drops soft-deleted and excluded notes can come
-- back with fewer than asked.
--
-- One difference from 0010: the query vector is parsed from its text once, in
-- a materialized CTE. Cast inline, it was parsed again for every note, twice,
-- and a lookup over the live vault's 1,288 notes took 560 ms. Parsed once it
-- takes about 20 ms.
--
-- A soft-deleted note keeps its vector (0021), so the notes row is joined and
-- deleted_at filtered here. `p_exclude` leaves out notes the caller already
-- has, such as the note a weekly connection starts from. The floor is applied
-- after the cap, as in 0010: a caller asking for two gets the nearest two that
-- clear it, or fewer. `p_user_id` null means whoever RLS lets the caller see;
-- a service-role caller passes the owner.
-- ---------------------------------------------------------------------------
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
  )
  select near.note_id, near.path, near.title, (1 - near.distance)::double precision
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
       limit least(greatest(coalesce(match_limit, 2), 1), 50)
    ) near
   where 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, near.path
$$;

comment on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[]) is
  'Live vault notes nearest a query vector by cosine similarity, closest first, above min_similarity.';

revoke all on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  from public, anon;
grant execute on function obsidian.nearest_notes(text, uuid, int, double precision, text, uuid[])
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The vectors of texts pages have asked about.
--
-- Keyed by owner, the sha256 of the text as embedded, and the model, so a
-- page view of a story or a card already asked about costs a read rather than
-- a Voyage call, and a change of model misses rather than mixes. The texts
-- are embedded as documents, as the notes are, so the same row serves any
-- page showing the same text. The text itself is not kept: it lives in the
-- story, card, job or goal it came from.
--
-- `used_at` is touched when a row is read, so rows no page has asked for in a
-- long while can be cleared without losing any that are still in use.
-- ---------------------------------------------------------------------------
create table obsidian.text_embeddings (
  user_id uuid not null references auth.users (id) on delete cascade,
  text_hash text not null,
  embedding_model text not null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  used_at timestamptz not null default now(),
  primary key (user_id, text_hash, embedding_model)
);

comment on table obsidian.text_embeddings is
  'Cached Voyage vectors of the texts pages asked for related notes of, by hash (plan #1112).';

alter table obsidian.text_embeddings enable row level security;

create policy text_embeddings_all on obsidian.text_embeddings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.text_embeddings from anon;
grant select, insert, update, delete on obsidian.text_embeddings to authenticated, service_role;
