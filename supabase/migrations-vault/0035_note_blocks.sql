-- Vault notes split at their headings, each part with its own vector
-- (plan #1863.7, LEARN-ESSAYS-SPEC "Schema").
--
-- note_embeddings (0021) gives a note one vector, which finds the note but not
-- the paragraph in it. The essay page's study panel (#1863.8) shows the
-- passage of a note nearest the paragraph being written, so each note is also
-- kept as blocks: one per heading section, with a long section cut further at
-- blank lines. lib/vault/notes/blocks.ts does the splitting; this file only
-- stores what it wrote and searches it.
--
-- A block holds no copy of its text. `start_offset` and `end_offset` are
-- character positions in the note's body (code points, as substring counts
-- them), and the search reads the passage out of the body. `text_hash` is the
-- md5 of what was embedded: the Folder > Note > Heading path, a blank line,
-- and the passage. A block whose hash is unchanged keeps its vector when the
-- note is split again, so editing one paragraph re-embeds only its block.
--
-- `source_hash` is the md5 of the note's path and body when it was split
-- (note_blocks_source_hash). A note whose current hash matches none of its
-- blocks is split again. Every note with something in its body has at least
-- one block; a block too short to search has no vector, which still marks
-- the note as split.

set search_path = obsidian, public, extensions;

create table obsidian.note_blocks (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references obsidian.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Order in the note, from 0.
  position int not null,
  -- The headings above the passage, outermost first; empty before the first.
  heading_path text[] not null default '{}',
  start_offset int not null,
  end_offset int not null,
  text_hash text not null,
  source_hash text not null,
  embedding extensions.vector(1024),
  embedding_model text,
  embedded_at timestamptz,
  check (start_offset >= 0 and end_offset > start_offset),
  check ((embedding is null) = (embedding_model is null))
);

comment on table obsidian.note_blocks is
  'Vault notes split at their headings, with a Voyage vector per passage, for passage search (plan #1863.7).';

create index note_blocks_embedding_idx
  on obsidian.note_blocks using hnsw (embedding extensions.vector_cosine_ops);
-- No key on (note_id, position): store_note_blocks clears and refills a
-- note's blocks in one statement, where such a key would meet the old rows.
create index note_blocks_note_idx on obsidian.note_blocks (note_id, text_hash);
create index note_blocks_user_idx on obsidian.note_blocks (user_id);

alter table obsidian.note_blocks enable row level security;

create policy note_blocks_all on obsidian.note_blocks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.note_blocks from anon;
grant select, insert, update, delete on obsidian.note_blocks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What decides whether a note needs splitting again: its path, which is in
-- every block's embedded text, and its body.
-- ---------------------------------------------------------------------------
create or replace function obsidian.note_blocks_source_hash(p_path text, p_body text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select md5(coalesce(p_path, '') || E'\n' || coalesce(p_body, ''))
$$;

-- ---------------------------------------------------------------------------
-- The live notes whose blocks are missing or were split from another version.
-- `p_user_id` null means every owner, which only the service role sees.
-- ---------------------------------------------------------------------------
create or replace function obsidian.stale_note_blocks(
  p_limit int,
  p_user_id uuid default null
)
returns table (note_id uuid, user_id uuid, path text, title text, body text, source_hash text)
language sql
stable
security invoker
set search_path = obsidian, pg_temp
as $$
  select n.id, n.user_id, n.path, n.title, n.body,
         obsidian.note_blocks_source_hash(n.path, n.body)
    from obsidian.notes n
   where n.deleted_at is null
     and (p_user_id is null or n.user_id = p_user_id)
     and btrim(coalesce(n.body, '')) <> ''
     and not exists (
       select 1 from obsidian.note_blocks b
        where b.note_id = n.id
          and b.source_hash = obsidian.note_blocks_source_hash(n.path, n.body)
     )
   order by n.user_id, n.path
   limit greatest(coalesce(p_limit, 16), 1)
$$;

-- ---------------------------------------------------------------------------
-- Replacing one note's blocks.
--
-- `p_rows` is a JSON array of {position, heading_path, start_offset,
-- end_offset, text_hash, embedding, model}, with `embedding` the pgvector
-- literal or null. A null embedding takes the vector of the note's current
-- block with the same text_hash and model, when there is one, so only changed
-- blocks are sent. Nothing is written unless the note still hashes to
-- `p_source_hash`. Returns the number of blocks written.
-- ---------------------------------------------------------------------------
create or replace function obsidian.store_note_blocks(
  p_note_id uuid,
  p_source_hash text,
  p_rows jsonb
)
returns int
language plpgsql
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
declare
  v_user uuid;
  v_written int;
begin
  select n.user_id into v_user
    from obsidian.notes n
   where n.id = p_note_id
     and obsidian.note_blocks_source_hash(n.path, n.body) = p_source_hash;
  if v_user is null then
    return 0;
  end if;

  -- One statement: every part of it reads the blocks as they were before it,
  -- so the vectors kept are looked up before the old rows go.
  with next_blocks as (
    select v.position,
           coalesce(array(select jsonb_array_elements_text(v.heading_path)), '{}') as heading_path,
           v.start_offset, v.end_offset, v.text_hash,
           coalesce(v.embedding::extensions.vector, kept.embedding) as embedding,
           case when v.embedding is not null then v.model else kept.embedding_model end as model
      from jsonb_to_recordset(p_rows) as v(
             position int, heading_path jsonb, start_offset int, end_offset int,
             text_hash text, embedding text, model text)
      left join lateral (
        select b.embedding, b.embedding_model
          from obsidian.note_blocks b
         where b.note_id = p_note_id and b.text_hash = v.text_hash
           and b.embedding is not null and v.embedding is null
           and b.embedding_model = v.model
         limit 1
      ) kept on true
  ),
  cleared as (
    delete from obsidian.note_blocks where note_id = p_note_id
  )
  insert into obsidian.note_blocks
         (note_id, user_id, position, heading_path, start_offset, end_offset,
          text_hash, source_hash, embedding, embedding_model, embedded_at)
  select p_note_id, v_user, nb.position, nb.heading_path, nb.start_offset, nb.end_offset,
         nb.text_hash, p_source_hash, nb.embedding,
         case when nb.embedding is null then null else nb.model end,
         case when nb.embedding is null then null else now() end
    from next_blocks nb;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- ---------------------------------------------------------------------------
-- The passages nearest a query vector, closest first.
--
-- Leaves out what nearest_notes leaves out (0024): deleted notes, templates
-- and CLAUDE.md or AGENTS.md. A block from a version of the note that has
-- since changed is skipped, since its offsets no longer point at its passage;
-- the next sync splits the note again.
-- ---------------------------------------------------------------------------
create or replace function obsidian.nearest_note_blocks(
  query_embedding text,
  p_user_id uuid default null,
  match_limit int default 5,
  min_similarity double precision default 0,
  embedding_model_filter text default null,
  p_exclude uuid[] default null
)
returns table (
  block_id uuid,
  note_id uuid,
  path text,
  title text,
  heading_path text[],
  passage text,
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
    select least(greatest(coalesce(match_limit, 5), 1), 50) as k
  )
  select near.id, near.note_id, n.path, n.title, near.heading_path,
         substring(n.body from near.start_offset + 1 for near.end_offset - near.start_offset),
         (1 - near.distance)::double precision
    from (
      select b.id, b.note_id, b.heading_path, b.start_offset, b.end_offset, b.source_hash,
             b.embedding <=> query.v as distance
        from query
       cross join obsidian.note_blocks b
       where b.embedding is not null
         and (p_user_id is null or b.user_id = p_user_id)
         and (embedding_model_filter is null or b.embedding_model = embedding_model_filter)
         and (p_exclude is null or b.note_id <> all (p_exclude))
       order by (b.embedding <=> query.v) + 0
       limit (select k + 20 from wanted)
    ) near
    join obsidian.notes n on n.id = near.note_id
   where n.deleted_at is null
     and n.path !~* '(^|/)templates/'
     and n.path !~* '(^|/)(claude|agents)\.md$'
     and obsidian.note_blocks_source_hash(n.path, n.body) = near.source_hash
     and 1 - near.distance >= coalesce(min_similarity, 0)
   order by near.distance, n.path
   limit (select k from wanted)
$$;

comment on function obsidian.nearest_note_blocks(text, uuid, int, double precision, text, uuid[]) is
  'Passages of live vault notes nearest a query vector by cosine similarity, closest first, with the note path and heading path.';

revoke all on function obsidian.note_blocks_source_hash(text, text) from public, anon;
revoke all on function obsidian.stale_note_blocks(int, uuid) from public, anon;
revoke all on function obsidian.store_note_blocks(uuid, text, jsonb) from public, anon;
revoke all on function obsidian.nearest_note_blocks(text, uuid, int, double precision, text, uuid[])
  from public, anon;
grant execute on function obsidian.note_blocks_source_hash(text, text) to authenticated, service_role;
grant execute on function obsidian.stale_note_blocks(int, uuid) to authenticated, service_role;
grant execute on function obsidian.store_note_blocks(uuid, text, jsonb) to authenticated, service_role;
grant execute on function obsidian.nearest_note_blocks(text, uuid, int, double precision, text, uuid[])
  to authenticated, service_role;
