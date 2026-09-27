-- Who wrote a note: you, or Dash (note 89ad8bef).
--
-- The Notes tab on a role is now a comment thread, and a comment there that
-- tags @dash gets a reply in the same thread. The thread is the role's notes,
-- oldest first, so the notes already written on a role are the first comments
-- in it and nothing is copied or moved.
--
-- author is 'me' for what you write and 'claude' for Dash's replies. Both are
-- written under your account, so the column is what tells the two apart, as
-- it does on core.file_comments and the goals threads. Every existing note is
-- yours, which the default says.

set search_path = job_search, extensions;

alter table notes add column if not exists author text not null default 'me';

alter table notes drop constraint if exists notes_author_ck;
alter table notes add constraint notes_author_ck check (author in ('me', 'claude'));

comment on column notes.author is
  '''me'' for what you wrote, ''claude'' for a reply from Dash on a role''s comment thread.';

notify pgrst, 'reload schema';
