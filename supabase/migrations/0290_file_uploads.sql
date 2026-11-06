-- A file you add to a goal, and a pin (plan #2778.7).
--
-- Until now every row in core.files was a piece of writing: markdown in
-- `body`. A goal's Work & files tab now takes a file you drop on it, such as
-- an approval letter as a PDF or a screenshot of a statement, and lists it
-- with Dash's files under Yours. The file itself goes where the documents a
-- form is filled from already go, the private goals-documents bucket (goals
-- migration 0011), uploaded by the browser on your session. Its row here
-- points at it:
--
--   storage_path   where it is in goals-documents: <your user id>/<uuid>-<name>.
--                  Set only for an added file; a written one has none.
--   content_type   the type the upload declared, one the bucket accepts.
--   size_bytes     its size, up to the bucket's 20 MB.
--
-- An added file has no text of its own, so its body may be empty. A written
-- file still needs one.
--
--   pinned_at      when you pinned the file, to keep it at the top of its
--                  goal's files. Null when it is not pinned. Pinning is not
--                  an edit: like read_at it leaves updated_at and the version
--                  alone (core.files_version only moves them for a new title
--                  or body).
--
-- Schema only: no existing row is changed.

set search_path = core, public, extensions;

alter table core.files
  add column storage_path text,
  add column content_type text,
  add column size_bytes integer,
  add column pinned_at timestamptz;

alter table core.files drop constraint files_body_ck;
alter table core.files add constraint files_body_ck check (
  length(body) <= 200000 and (storage_path is not null or btrim(body) <> '')
);

alter table core.files add constraint files_storage_ck check (
  (storage_path is null and content_type is null and size_bytes is null)
  or (
    storage_path is not null
    and storage_path ~ '^[0-9a-f-]{36}/[^/]+$'
    and length(storage_path) <= 400
    and content_type is not null
    and length(content_type) <= 200
    and size_bytes is not null
    and size_bytes between 0 and 20971520
  )
);

comment on column core.files.storage_path is
  'For a file the person added: where it is in the goals-documents bucket, <user id>/<uuid>-<name>. Null for a file that is a piece of writing.';
comment on column core.files.content_type is 'The added file''s type. Set exactly when storage_path is.';
comment on column core.files.size_bytes is 'The added file''s size in bytes. Set exactly when storage_path is.';
comment on column core.files.pinned_at is
  'When the person pinned the file to the top of its goal''s files; null when not pinned.';

notify pgrst, 'reload schema';
