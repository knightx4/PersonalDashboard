-- Once a week, the notes you wrote recently that come back to older ones
-- (plan #1115, under #1110).
--
-- Three parts: a date on each note saying when it was last written in, the
-- lookup that pairs this week's notes with their nearest older ones, and the
-- table the weekly run leaves its connections in for the vault page.
--
-- 1. obsidian.notes.written_at
--
-- "Recent" cannot be read off the dates the notes already carry. git_updated_at
-- is the time of the commit a sync caught up to, so every note one sync
-- touches gets the same stamp: on 22 September 2026 a single sync stamped 141
-- notes at 20:29:08, most of them job application files that had only been
-- moved or touched in passing. updated_at moves on any write, renames
-- included. So a note gets its own date: when it first reached the app, and
-- again whenever a sync grows it by at least 200 characters of prose (as
-- obsidian.note_prose_chars counts them: links, tags, markdown punctuation and
-- whitespace left out). 200 is about forty words, a short paragraph. A typo
-- fixed, a link added or a note moved leaves it where it was.
--
-- Existing notes start from created_at, the day the app first saw them. The
-- backfill runs with the updated_at trigger off, so it does not restamp 1,288
-- notes as changed today.
--
-- 2. obsidian.recent_note_neighbours
--
-- For each note written in since p_since, its nearest p_per_note older notes
-- above p_min_similarity. The same notes are left out on both sides as in
-- nearest_notes (0023, 0024): soft-deleted notes, stubs under 20 characters of
-- prose, templates, and CLAUDE.md or AGENTS.md. The prose length of each note
-- comes back too, because the run leaves out exports and compilations by
-- length (lib/vault/notes/connections.ts). An exact scan: a week's notes times
-- the vault is a few hundred thousand distances, once a week.
--
-- 3. obsidian.note_connections
--
-- One row per connection: an older note and the recent notes (one to three)
-- that come back to it, the sentence Dash wrote about them, and when the
-- person hid it. week_ending is the day the run looked back from. A row holds
-- what the person wrote, read together, so it is a Goals source
-- (lib/vault/sources.ts). The run writes through the service role; the owner
-- reads their rows and may set dismissed_at, and nothing else.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. When a note was last written in.
-- ---------------------------------------------------------------------------
alter table obsidian.notes add column written_at timestamptz;

alter table obsidian.notes disable trigger notes_touch_updated_at;
update obsidian.notes set written_at = created_at where written_at is null;
alter table obsidian.notes enable trigger notes_touch_updated_at;

alter table obsidian.notes
  alter column written_at set default now(),
  alter column written_at set not null;

comment on column obsidian.notes.written_at is
  'When the note first reached the app, or last grew by at least 200 characters of prose (plan #1115).';

create index notes_user_written_idx on obsidian.notes (user_id, written_at desc);

create or replace function obsidian.stamp_note_written_at()
returns trigger
language plpgsql
set search_path = obsidian, pg_temp
as $$
begin
  if new.body is distinct from old.body
     and obsidian.note_prose_chars(new.body) - obsidian.note_prose_chars(old.body) >= 200
  then
    new.written_at := now();
  else
    new.written_at := old.written_at;
  end if;
  return new;
end;
$$;

create trigger notes_stamp_written_at
  before update on obsidian.notes
  for each row execute function obsidian.stamp_note_written_at();

-- ---------------------------------------------------------------------------
-- 2. This week's notes and their nearest older ones.
-- ---------------------------------------------------------------------------
create or replace function obsidian.recent_note_neighbours(
  p_user_id uuid,
  p_since timestamptz,
  p_per_note int default 5,
  p_min_similarity double precision default 0.55
)
returns table (
  recent_id uuid,
  recent_path text,
  recent_title text,
  recent_chars int,
  older_id uuid,
  older_path text,
  older_title text,
  older_chars int,
  similarity double precision
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with eligible as materialized (
    select n.id, n.path, n.title, n.written_at,
           obsidian.note_prose_chars(n.body) as chars,
           e.embedding, e.embedding_model
      from obsidian.notes n
      join obsidian.note_embeddings e on e.note_id = n.id
     where n.user_id = p_user_id
       and n.deleted_at is null
       and n.path !~* '(^|/)templates/'
       and n.path !~* '(^|/)(claude|agents)\.md$'
  ),
  kept as materialized (
    select * from eligible where chars >= 20
  ),
  recent as (
    select * from kept where written_at >= p_since
  ),
  older as (
    select * from kept where written_at < p_since
  )
  select r.id, r.path, r.title, r.chars,
         o.id, o.path, o.title, o.chars, o.similarity
    from recent r
   cross join lateral (
     select older.id, older.path, older.title, older.chars,
            (1 - (older.embedding <=> r.embedding))::double precision as similarity
       from older
      where older.embedding_model = r.embedding_model
      order by older.embedding <=> r.embedding
      limit least(greatest(coalesce(p_per_note, 5), 1), 20)
   ) o
   where o.similarity >= coalesce(p_min_similarity, 0)
   order by r.path, o.similarity desc
$$;

comment on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision) is
  'Each note written in since p_since, with its nearest older notes above p_min_similarity (plan #1115).';

revoke all on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision)
  from public, anon;
grant execute on function obsidian.recent_note_neighbours(uuid, timestamptz, int, double precision)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The week's connections.
-- ---------------------------------------------------------------------------
create table obsidian.note_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_ending date not null,
  older_note_id uuid not null references obsidian.notes (id) on delete cascade,
  recent_note_ids uuid[] not null
    check (cardinality(recent_note_ids) between 1 and 3),
  sentence text,
  -- The closest pair in the connection, kept for tuning; never shown.
  similarity double precision not null,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, week_ending, older_note_id)
);

comment on table obsidian.note_connections is
  'Each week, an older vault note and the recent notes that come back to it, with a sentence on what they share (plan #1115).';

create index note_connections_user_created_idx
  on obsidian.note_connections (user_id, created_at desc);

alter table obsidian.note_connections enable row level security;

create policy note_connections_select on obsidian.note_connections for select to authenticated
  using (user_id = (select auth.uid()));

create policy note_connections_update on obsidian.note_connections for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.note_connections from anon, authenticated;
grant select on obsidian.note_connections to authenticated;
grant update (dismissed_at) on obsidian.note_connections to authenticated;
grant select, insert, update, delete on obsidian.note_connections to service_role;
