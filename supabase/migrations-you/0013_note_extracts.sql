-- The person's own words, pulled out of their private notes (plan #2413.8,
-- under #2413).
--
-- An insight run that reads the whole vault every month reads five hundred
-- private notes to find a few hundred lines that say who the person is. Each
-- private note is now read once per version by one Haiku call
-- (lib/you/note-extracts.ts, on the map sweep's tick straight after the voice
-- tagging), which keeps four kinds of line, each with its quote:
--
--   concept  a name they coined or use for an idea of their own, such as
--            Socrates Mode or rest in reason; gist is the name
--   claim    something they say about themselves: what they are like, what
--            they do, what they believe
--   want     something they say they want, hope for or mean to do
--   mood     a dated line about their mood or energy
--
-- entry_date is the date of the dated entry the quote sits under, or of the
-- note when the note is one dated entry; null when the note gives none. A
-- mood line always has one.
--
-- 1. you.note_extracts holds the lines. A note's rows are replaced together
--    whenever its blob changes, so they always come from one version of it.
-- 2. you.note_extract_reads records which version of each note was read,
--    including a read that found nothing, so the note is not sent again until
--    it changes.
--
-- Only notes tagged private (obsidian.notes.voice, vault 0038) whose tag is
-- current are read. Secret, clipped, audience and reference notes are never
-- sent, and a note that stops being private loses its rows on the next tick
-- (you.prune_note_extracts).

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The lines.
-- ---------------------------------------------------------------------------

create table you.note_extracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null,
  blob_sha text not null,
  kind text not null,
  gist text check (gist is null or char_length(gist) between 1 and 200),
  quote text not null check (char_length(quote) between 1 and 1000),
  entry_date date,
  created_at timestamptz not null default now(),
  constraint note_extracts_kind_ck check (kind in ('concept', 'claim', 'want', 'mood')),
  constraint note_extracts_mood_dated_ck check (kind <> 'mood' or entry_date is not null),
  constraint note_extracts_note_fk foreign key (note_id, user_id)
    references obsidian.notes (id, user_id) on delete cascade
);

comment on table you.note_extracts is
  'Lines from the person''s private notes that say who they are: concepts they name, claims about themselves, wants, and dated mood lines, each with its quote (plan #2413.8).';
comment on column you.note_extracts.kind is
  'concept, claim, want or mood.';
comment on column you.note_extracts.gist is
  'The concept''s name, or the line in a few words.';
comment on column you.note_extracts.quote is
  'Their words, as written in the note.';
comment on column you.note_extracts.entry_date is
  'The date of the entry the quote sits under, or null when the note gives none.';
comment on column you.note_extracts.blob_sha is
  'The version of the note the line was read from.';

create index note_extracts_user_kind_idx on you.note_extracts (user_id, kind, entry_date desc);
create index note_extracts_note_idx on you.note_extracts (note_id);

-- ---------------------------------------------------------------------------
-- 2. Which version of each note was read.
-- ---------------------------------------------------------------------------

create table you.note_extract_reads (
  note_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  blob_sha text not null,
  lines int not null check (lines >= 0),
  read_at timestamptz not null default now(),
  constraint note_extract_reads_note_fk foreign key (note_id, user_id)
    references obsidian.notes (id, user_id) on delete cascade
);

comment on table you.note_extract_reads is
  'The version of each private note last read for you.note_extracts, and how many lines it gave (plan #2413.8).';

create index note_extract_reads_user_idx on you.note_extract_reads (user_id);

-- ---------------------------------------------------------------------------
-- 3. Row level security: the person may read their own; only the service
--    role writes.
-- ---------------------------------------------------------------------------

alter table you.note_extracts enable row level security;
alter table you.note_extract_reads enable row level security;

create policy note_extracts_select on you.note_extracts for select to authenticated
  using (user_id = (select auth.uid()));

create policy note_extract_reads_select on you.note_extract_reads for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.note_extracts, you.note_extract_reads from anon, authenticated;
grant select on you.note_extracts, you.note_extract_reads to authenticated;
grant select, insert, update, delete on you.note_extracts, you.note_extract_reads to service_role;

-- ---------------------------------------------------------------------------
-- 4. The notes due a read: private, tagged for their current blob and path,
--    holding no credentials, and not yet read at this blob. Null means every
--    account, which only the map sweep's tick asks for. The body is cut at
--    80,000 characters; the longest private note on 18 October 2026 was
--    72,000.
-- ---------------------------------------------------------------------------

create or replace function you.note_extracts_due(
  p_user_id uuid default null,
  p_after_id uuid default null,
  p_limit int default 24
)
returns table (
  id uuid,
  user_id uuid,
  path text,
  title text,
  body text,
  blob_sha text
)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select n.id, n.user_id, n.path, n.title, left(n.body, 80000), n.blob_sha
    from obsidian.notes n
    left join you.note_extract_reads r on r.note_id = n.id
   where n.deleted_at is null
     and n.voice = 'private'
     and not n.voice_due
     and (p_user_id is null or n.user_id = p_user_id)
     and (p_after_id is null or n.id > p_after_id)
     and r.blob_sha is distinct from n.blob_sha
     and not obsidian.note_holds_secret(n.path, n.title, n.body)
   order by n.id
   limit greatest(p_limit, 0)
$$;

comment on function you.note_extracts_due(uuid, uuid, int) is
  'Private notes not yet read at their current blob, with up to 80,000 characters of body, for the extract model (plan #2413.8).';

-- ---------------------------------------------------------------------------
-- 5. Replace one note's lines with what one read found. Writes nothing and
--    returns null when the note has changed or stopped being private since it
--    was read, so a stale answer never lands.
-- ---------------------------------------------------------------------------

create or replace function you.save_note_extracts(
  p_user_id uuid,
  p_note_id uuid,
  p_blob_sha text,
  p_lines jsonb
)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count int;
begin
  perform 1
     from obsidian.notes n
    where n.id = p_note_id
      and n.user_id = p_user_id
      and n.blob_sha = p_blob_sha
      and n.deleted_at is null
      and n.voice = 'private'
      and not n.voice_due
    for update;
  if not found then
    return null;
  end if;

  delete from you.note_extracts e
   where e.note_id = p_note_id
     and e.user_id = p_user_id;

  insert into you.note_extracts (user_id, note_id, blob_sha, kind, gist, quote, entry_date)
  select p_user_id, p_note_id, p_blob_sha, l.kind, nullif(l.gist, ''), l.quote, l.entry_date
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
         as l(kind text, gist text, quote text, entry_date date);
  get diagnostics v_count = row_count;

  insert into you.note_extract_reads (note_id, user_id, blob_sha, lines, read_at)
  values (p_note_id, p_user_id, p_blob_sha, v_count, now())
  on conflict (note_id) do update
    set blob_sha = excluded.blob_sha,
        lines = excluded.lines,
        read_at = excluded.read_at;

  return v_count;
end
$$;

comment on function you.save_note_extracts(uuid, uuid, text, jsonb) is
  'Replaces one private note''s extracted lines with a new read at the given blob, or returns null when the note changed or is no longer private (plan #2413.8).';

-- ---------------------------------------------------------------------------
-- 6. Drop the lines of notes that are gone or no longer private. A note whose
--    voice is due again keeps its lines until it is tagged, unless it now
--    holds credentials.
-- ---------------------------------------------------------------------------

create or replace function you.prune_note_extracts(p_user_id uuid default null)
returns int
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count int;
begin
  with gone as (
    select r.note_id
      from you.note_extract_reads r
      join obsidian.notes n on n.id = r.note_id
     where (p_user_id is null or r.user_id = p_user_id)
       and (
         n.deleted_at is not null
         or n.voice is distinct from 'private' and not n.voice_due
         or n.voice = 'secret'
         or obsidian.note_holds_secret(n.path, n.title, n.body)
       )
  ),
  lines as (
    delete from you.note_extracts e using gone where e.note_id = gone.note_id returning 1
  ),
  reads as (
    delete from you.note_extract_reads r using gone where r.note_id = gone.note_id returning 1
  )
  select count(*)::int into v_count from reads;
  return v_count;
end
$$;

comment on function you.prune_note_extracts(uuid) is
  'Removes the extracted lines of notes deleted or no longer private, returning how many notes lost theirs (plan #2413.8).';

revoke all on function you.note_extracts_due(uuid, uuid, int) from public, anon, authenticated;
revoke all on function you.save_note_extracts(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function you.prune_note_extracts(uuid) from public, anon, authenticated;
grant execute on function you.note_extracts_due(uuid, uuid, int) to service_role;
grant execute on function you.save_note_extracts(uuid, uuid, text, jsonb) to service_role;
grant execute on function you.prune_note_extracts(uuid) to service_role;

notify pgrst, 'reload schema';
