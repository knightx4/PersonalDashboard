-- Comments on files (note 7a6a37aa).
--
-- A file at /goals/files/<id> could be read and not answered: what you
-- thought of a breakdown or a draft went nowhere near it. A file now has a
-- thread under it, as a goal or a step does (migrations-goals/0013):
--
--   file_comments  one row per message on a file: who wrote it, what it says,
--                  when. An archived file keeps its thread; a deleted one
--                  takes it with it.
--
-- author is 'me' for what you write and 'claude' for Dash's. Both are written
-- under your account, so the column is what tells them apart. A comment is
-- written or deleted, never edited. The goals skill reads a file's thread
-- before revising the file, so a comment is how you ask for a change to it.

set search_path = core, public, extensions;

create table core.file_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  file_id uuid not null,
  author text not null default 'me',
  body text not null,

  created_at timestamptz not null default now(),

  constraint file_comments_file_fk foreign key (file_id, user_id)
    references core.files (id, user_id) on delete cascade,
  constraint file_comments_author_ck check (author in ('me', 'claude')),
  constraint file_comments_body_ck check (btrim(body) <> '' and length(body) <= 4000)
);

create index file_comments_file_idx on core.file_comments (file_id, created_at);
create index file_comments_user_idx on core.file_comments (user_id);

alter table core.file_comments enable row level security;

create policy file_comments_all on core.file_comments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on core.file_comments from anon, public;
grant select, insert, delete on core.file_comments to authenticated, service_role;

comment on table core.file_comments is
  'The thread under a file in core.files: what you wrote on it, and Dash''s replies. Read before revising the file.';

notify pgrst, 'reload schema';
