-- An embedding on every theme and position (plan #810).
--
-- The merge passes (#811, #812) need to find two differently worded names for
-- the same subject, and trigram cannot: on the first full sweep, same-subject
-- theme names such as "Urban design and travel patterns" and "15-minute
-- cities" scored 0.00. A vector of what each row means can.
--
-- Same shape as learn.catalogue_segments (migrations-learn/0022 and 0025):
-- a 1,024-wide vector from the Voyage 4 family, the model that produced it,
-- and when it was written. The three columns are null together or set
-- together.
--
-- What is embedded is defined here, once, by obsidian.map_embedding_text, and
-- both the read and the write go through it:
--
--   theme      name, a blank line, about
--   position   statement
--
-- A row whose text changes loses its vector in the same statement (the
-- triggers below), so it drops back into the list of rows to embed. Nothing
-- rewrites these fields today, since accept_note_map inserts themes with
-- `on conflict do nothing`, but a merge (#813) will, and a vector for a name
-- the row no longer has would find neighbours for the wrong text.
--
-- The work to do is the absence of a vector, as with the catalogue sweep: the
-- partial indexes are the list, a row leaves it when its vector is written,
-- and a run that stops halfway leaves the rest where the next run looks.

set search_path = obsidian, public, extensions;

-- learn/0022 creates the extension on the live project, but the vault
-- migrations run before learn's when a database is built from the files
-- (scripts/db-reset.sh), so this one cannot rely on it being there.
create extension if not exists vector with schema extensions;

alter table obsidian.themes
  add column embedding extensions.vector(1024),
  add column embedding_model text,
  add column embedded_at timestamptz,
  add constraint themes_embedding_ck check (
    (embedding is null) = (embedding_model is null)
    and (embedding is null) = (embedded_at is null)
  );

alter table obsidian.positions
  add column embedding extensions.vector(1024),
  add column embedding_model text,
  add column embedded_at timestamptz,
  add constraint positions_embedding_ck check (
    (embedding is null) = (embedding_model is null)
    and (embedding is null) = (embedded_at is null)
  );

-- Nearest-neighbour search, cosine, for the merge passes and for offering the
-- extractor the closest existing themes (#818).
create index themes_embedding_idx
  on obsidian.themes using hnsw (embedding extensions.vector_cosine_ops);
create index positions_embedding_idx
  on obsidian.positions using hnsw (embedding extensions.vector_cosine_ops);

-- Which rows still need a vector. Empty, and free, once the sweep has caught up.
create index themes_unembedded_idx on obsidian.themes (user_id) where embedding is null;
create index positions_unembedded_idx on obsidian.positions (user_id) where embedding is null;

-- ---------------------------------------------------------------------------
-- The text a row is embedded from.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_embedding_text(p_name text, p_about text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_about is null then p_name else p_name || E'\n\n' || p_about end
$$;

comment on function obsidian.map_embedding_text(text, text) is
  'What a theme (name, about) or a position (statement, null) is embedded from.';

-- ---------------------------------------------------------------------------
-- A row whose text changes loses its vector.
-- ---------------------------------------------------------------------------
create or replace function obsidian.clear_stale_theme_embedding()
returns trigger
language plpgsql
set search_path = obsidian
as $$
begin
  if new.name is distinct from old.name or new.about is distinct from old.about then
    new.embedding := null;
    new.embedding_model := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

create or replace function obsidian.clear_stale_position_embedding()
returns trigger
language plpgsql
set search_path = obsidian
as $$
begin
  if new.statement is distinct from old.statement then
    new.embedding := null;
    new.embedding_model := null;
    new.embedded_at := null;
  end if;
  return new;
end;
$$;

create trigger themes_clear_stale_embedding
  before update of name, about on obsidian.themes
  for each row execute function obsidian.clear_stale_theme_embedding();

create trigger positions_clear_stale_embedding
  before update of statement on obsidian.positions
  for each row execute function obsidian.clear_stale_position_embedding();

revoke all on function obsidian.clear_stale_theme_embedding() from public, anon, authenticated;
revoke all on function obsidian.clear_stale_position_embedding() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading the rows with no vector, with the text to embed.
--
-- `p_user_id` null means every owner, which is what the service-role sweep
-- asks for; a signed-in caller only sees their own rows through RLS either
-- way. Ordered by owner so one run's spend groups by the account it belongs
-- to.
-- ---------------------------------------------------------------------------
create or replace function obsidian.unembedded_map_rows(
  p_kind text,
  p_limit int,
  p_user_id uuid default null
)
returns table (id uuid, user_id uuid, text text)
language plpgsql
stable
security invoker
set search_path = obsidian, pg_temp
as $$
begin
  if p_kind = 'theme' then
    return query
      select t.id, t.user_id, obsidian.map_embedding_text(t.name, t.about)
        from obsidian.themes t
       where t.embedding is null
         and (p_user_id is null or t.user_id = p_user_id)
       order by t.user_id, t.created_at, t.id
       limit greatest(coalesce(p_limit, 64), 1);
  elsif p_kind = 'position' then
    return query
      select p.id, p.user_id, obsidian.map_embedding_text(p.statement, null)
        from obsidian.positions p
       where p.embedding is null
         and (p_user_id is null or p.user_id = p_user_id)
       order by p.user_id, p.created_at, p.id
       limit greatest(coalesce(p_limit, 64), 1);
  else
    raise exception 'Unknown map row kind: %', p_kind using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing the vectors.
--
-- `p_rows` is a JSON array of {id, text, embedding, model}, with `embedding`
-- as the `[0.1,0.2,...]` literal pgvector parses. A row is only written when
-- its text is still the text that was embedded, so a row rewritten between the
-- read and the write keeps its null and is embedded next time. Returns how
-- many rows were written.
-- ---------------------------------------------------------------------------
create or replace function obsidian.store_map_embeddings(p_kind text, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
declare
  v_written int;
begin
  if p_kind = 'theme' then
    update obsidian.themes t
       set embedding = v.embedding::extensions.vector,
           embedding_model = v.model,
           embedded_at = now()
      from jsonb_to_recordset(p_rows) as v(id uuid, text text, embedding text, model text)
     where t.id = v.id
       and obsidian.map_embedding_text(t.name, t.about) = v.text;
  elsif p_kind = 'position' then
    update obsidian.positions p
       set embedding = v.embedding::extensions.vector,
           embedding_model = v.model,
           embedded_at = now()
      from jsonb_to_recordset(p_rows) as v(id uuid, text text, embedding text, model text)
     where p.id = v.id
       and obsidian.map_embedding_text(p.statement, null) = v.text;
  else
    raise exception 'Unknown map row kind: %', p_kind using errcode = '22023';
  end if;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function obsidian.map_embedding_text(text, text) from public, anon;
revoke all on function obsidian.unembedded_map_rows(text, int, uuid) from public, anon;
revoke all on function obsidian.store_map_embeddings(text, jsonb) from public, anon;
grant execute on function obsidian.map_embedding_text(text, text) to authenticated, service_role;
grant execute on function obsidian.unembedded_map_rows(text, int, uuid) to authenticated, service_role;
grant execute on function obsidian.store_map_embeddings(text, jsonb) to authenticated, service_role;
