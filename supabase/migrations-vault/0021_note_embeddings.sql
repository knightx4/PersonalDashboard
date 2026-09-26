-- A meaning vector for every vault note (plan #1111).
--
-- Feature #1110 shows a person's own notes beside the news story, Learn card,
-- job or goal they relate to, and once a week the notes that connect to older
-- ones. Matching by subject rather than by shared words needs a vector per
-- note. Themes and positions already have one (0006); notes did not.
--
-- A table of its own rather than three columns on obsidian.notes. The notes
-- row is rewritten by every sync, and the list query reads it constantly; a
-- 1,024-wide vector on it would ride along on every one of those reads.
--
-- The same shape as 0006 otherwise: a Voyage 4 vector, the model that made
-- it, and when. What is embedded is defined once, by
-- obsidian.note_embedding_text, and `body_hash` is the md5 of that text at
-- the time the vector was made. A note whose current text hashes differently
-- is stale, which is how a changed note comes back round without a trigger on
-- the hottest write in the vault, and how an unchanged one is never embedded
-- twice.
--
-- A soft-deleted note keeps its vector, so a note that comes back after a bad
-- commit does not cost a second call. Whatever reads these filters on
-- notes.deleted_at. A note removed for good takes its vector with it.

set search_path = obsidian, public, extensions;

create extension if not exists vector with schema extensions;

create table obsidian.note_embeddings (
  note_id uuid primary key references obsidian.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  -- md5 of obsidian.note_embedding_text(title, body) when the vector was made.
  body_hash text not null,
  embedded_at timestamptz not null default now()
);

comment on table obsidian.note_embeddings is
  'One Voyage vector per vault note, with the hash of the text it was made from (plan #1111).';

-- Nearest notes by cosine, for #1112 onwards.
create index note_embeddings_embedding_idx
  on obsidian.note_embeddings using hnsw (embedding extensions.vector_cosine_ops);
create index note_embeddings_user_idx on obsidian.note_embeddings (user_id);

alter table obsidian.note_embeddings enable row level security;

create policy note_embeddings_all on obsidian.note_embeddings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.note_embeddings from anon;
grant select, insert, update, delete on obsidian.note_embeddings to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The text a note is embedded from: its title, a blank line, its body, cut at
-- 120,000 characters. voyage-4-lite reads 32,000 tokens, which is about that
-- many characters of prose; the provider truncates whatever is still over.
-- Cutting here as well keeps a 470,000-character export from being sent whole
-- only to be thrown away, and keeps the hash about the text that was read.
-- ---------------------------------------------------------------------------
create or replace function obsidian.note_embedding_text(p_title text, p_body text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select left(btrim(coalesce(p_title, '') || E'\n\n' || coalesce(p_body, '')), 120000)
$$;

comment on function obsidian.note_embedding_text(text, text) is
  'What a vault note is embedded from: title, blank line, body, cut at 120,000 characters.';

-- ---------------------------------------------------------------------------
-- The notes whose vector is missing or was made from other text.
--
-- `p_user_id` null means every owner, which only the service role sees; a
-- signed-in caller sees their own rows through RLS either way. Ordered by
-- owner so a run's spend groups by the account it belongs to.
-- ---------------------------------------------------------------------------
create or replace function obsidian.stale_note_embeddings(
  p_limit int,
  p_user_id uuid default null
)
returns table (note_id uuid, user_id uuid, text text, body_hash text)
language sql
stable
security invoker
set search_path = obsidian, pg_temp
as $$
  select s.id, s.user_id, s.text, s.body_hash
    from (
      select n.id, n.user_id, n.path, t.text, md5(t.text) as body_hash
        from obsidian.notes n
        cross join lateral (select obsidian.note_embedding_text(n.title, n.body) as text) t
       where n.deleted_at is null
         and (p_user_id is null or n.user_id = p_user_id)
    ) s
    left join obsidian.note_embeddings e on e.note_id = s.id
   where s.text <> ''
     and (e.note_id is null or e.body_hash <> s.body_hash)
   order by s.user_id, s.path
   limit greatest(coalesce(p_limit, 32), 1)
$$;

-- ---------------------------------------------------------------------------
-- Writing the vectors.
--
-- `p_rows` is a JSON array of {note_id, body_hash, embedding, model}, with
-- `embedding` as the `[0.1,0.2,...]` literal pgvector parses. A vector is only
-- written while the note still has the text it was made from, so a note that
-- changed between the read and the write stays stale and is embedded next
-- time. Returns how many were written.
-- ---------------------------------------------------------------------------
create or replace function obsidian.store_note_embeddings(p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
declare
  v_written int;
begin
  insert into obsidian.note_embeddings as e
         (note_id, user_id, embedding, embedding_model, body_hash, embedded_at)
  select n.id, n.user_id, v.embedding::extensions.vector, v.model, v.body_hash, now()
    from jsonb_to_recordset(p_rows) as v(note_id uuid, body_hash text, embedding text, model text)
    join obsidian.notes n on n.id = v.note_id
   where md5(obsidian.note_embedding_text(n.title, n.body)) = v.body_hash
  on conflict (note_id) do update
     set embedding = excluded.embedding,
         embedding_model = excluded.embedding_model,
         body_hash = excluded.body_hash,
         embedded_at = excluded.embedded_at;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function obsidian.note_embedding_text(text, text) from public, anon;
revoke all on function obsidian.stale_note_embeddings(int, uuid) from public, anon;
revoke all on function obsidian.store_note_embeddings(jsonb) from public, anon;
grant execute on function obsidian.note_embedding_text(text, text) to authenticated, service_role;
grant execute on function obsidian.stale_note_embeddings(int, uuid) to authenticated, service_role;
grant execute on function obsidian.store_note_embeddings(jsonb) to authenticated, service_role;
