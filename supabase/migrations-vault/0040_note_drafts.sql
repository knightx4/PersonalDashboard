-- Edits made in the app wait here before they go to the vault repository
-- (note of 20 October 2026).
--
-- The note editor saves as you write. Each save used to be a commit to the
-- vault, so an evening of writing left dozens of "Edit … from Dash" commits.
-- Now a pause in typing writes the note's text here, and the note-drafts tick
-- (/api/cron/note-drafts, every five minutes) commits a draft once it has sat
-- for ten minutes untouched: one commit for a sitting.
--
-- One draft per note. base_blob_sha is the version of the note the draft was
-- started from; the commit is refused if the note has moved on in Obsidian
-- since, and `failure` then says why, for the note's page to show.

set search_path = obsidian, public, extensions;

create table obsidian.note_drafts (
  note_id uuid primary key references obsidian.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  base_blob_sha text not null,
  updated_at timestamptz not null default now(),
  failure text,
  constraint note_drafts_failure_ck
    check (failure is null or failure in ('changed', 'read-only', 'reconnect', 'not-found', 'too-large'))
);

comment on table obsidian.note_drafts is
  'A note''s text as edited in the app, waiting to be committed to the vault after ten quiet minutes.';
comment on column obsidian.note_drafts.base_blob_sha is
  'The version of the note the draft was started from; the commit is refused if the note has moved on.';
comment on column obsidian.note_drafts.failure is
  'Why the last commit was refused, null while the draft is waiting. A refused draft is not tried again until it is edited or the person decides.';

create index note_drafts_due_idx on obsidian.note_drafts (updated_at) where failure is null;
create index note_drafts_user_idx on obsidian.note_drafts (user_id);

alter table obsidian.note_drafts enable row level security;

create policy note_drafts_all on obsidian.note_drafts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on obsidian.note_drafts from anon;
grant select, insert, update, delete on obsidian.note_drafts to authenticated, service_role;
