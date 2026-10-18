-- When each vault note was first written (plan #2413.2, under #2413).
--
-- created_at is the day the app first saw a note, so 1,300 of 1,317 notes say
-- September 2026, the first sync. An insight that says what came before what
-- needs the day the person wrote the note. The evidence for that is scattered:
-- the first commit that added the file, a date in its filename, a dated
-- heading or line in its body, a date in its frontmatter, and the timestamp
-- in a pasted image's name. Each says "written no later than this", so the
-- earliest one wins (lib/vault/notes/first-written.ts).
--
-- Columns on obsidian.notes:
--
--   first_written_at       the earliest date any evidence gives; null when
--                          there is none
--   first_written_source   which kind of evidence gave it
--   dated_entries          the dated entries inside a long note such as
--                          Me/Journal.md, as [{date, offset, end}]: date is
--                          YYYY-MM-DD, offset and end are code-point
--                          positions in body, so substr(body, offset + 1,
--                          end - offset) is one entry in SQL as well as in
--                          TypeScript
--   git_first_commit_at    when the first commit that added the file at its
--                          path was authored, kept so a change to the body
--                          can be re-dated without asking GitHub again
--   git_first_commit_checked_at  when that commit was looked up; null means
--                          not yet, which is what makes the backfill resumable
--   first_written_blob_sha the blob the dates were read from; a sync that
--                          changes the blob makes the note due again
--   first_written_due      generated: not yet looked up, or changed since
--
-- sync_runs.notes_dated counts the notes a run dated, so the backfill shows
-- in the same run log as the sync that carried it.
--
-- The dating pass writes only these columns, and it must not move updated_at:
-- the Maya gate reads updated_at as "the text changed" (inngest/vault/
-- maya-gate.ts) and would re-read the whole vault. So notes_touch_updated_at
-- is recreated to fire on updates of every other column and not these.

set search_path = obsidian, public, extensions;

create type obsidian.first_written_source as enum (
  'git_first_commit',
  'filename',
  'body',
  'frontmatter',
  'image_name'
);

alter table obsidian.notes
  add column first_written_at timestamptz,
  add column first_written_source obsidian.first_written_source,
  add column dated_entries jsonb not null default '[]'::jsonb,
  add column git_first_commit_at timestamptz,
  add column git_first_commit_checked_at timestamptz,
  add column first_written_blob_sha text,
  add constraint notes_first_written_pair_ck
    check ((first_written_at is null) = (first_written_source is null)),
  add constraint notes_dated_entries_array_ck
    check (jsonb_typeof(dated_entries) = 'array');

comment on column obsidian.notes.first_written_at is
  'The earliest date any evidence gives for when the note was written (plan #2413.2).';
comment on column obsidian.notes.first_written_source is
  'Which evidence gave first_written_at: git_first_commit, filename, body, frontmatter or image_name.';
comment on column obsidian.notes.dated_entries is
  'Dated entries inside the note, [{date: YYYY-MM-DD, offset, end}] in code points of body.';
comment on column obsidian.notes.git_first_commit_at is
  'Author date of the first commit that added the file at its path.';
comment on column obsidian.notes.git_first_commit_checked_at is
  'When the first commit was looked up; null until the dating backfill reaches the note.';
comment on column obsidian.notes.first_written_blob_sha is
  'The blob first_written_at and dated_entries were read from.';

-- The notes still to date: never looked up on GitHub, or changed since they
-- were dated. A column rather than only an index predicate, because the
-- dating pass reads through PostgREST, which cannot compare two columns.
alter table obsidian.notes
  add column first_written_due boolean
  generated always as (
    git_first_commit_checked_at is null or first_written_blob_sha is distinct from blob_sha
  ) stored;

comment on column obsidian.notes.first_written_due is
  'True while the note has not been looked up on GitHub, or its blob changed since it was dated.';

create index notes_first_written_due_idx
  on obsidian.notes (connection_id, path)
  where deleted_at is null and first_written_due;

create index notes_user_first_written_idx
  on obsidian.notes (user_id, first_written_at)
  where deleted_at is null;

alter table obsidian.sync_runs
  add column notes_dated int not null default 0;

create or replace trigger notes_touch_updated_at
  before update of
    id, user_id, connection_id, path, title, body, frontmatter, blob_sha,
    size_bytes, git_updated_at, deleted_at, created_at, updated_at, written_at
  on obsidian.notes
  for each row execute function obsidian.touch_updated_at();
