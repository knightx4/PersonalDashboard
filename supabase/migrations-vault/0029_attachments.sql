-- Vault attachments: the images, PDFs and audio a note embeds, and the private
-- bucket their copies live in (plan #1299, under #1298).
--
-- A vault is more than its .md files. A note that embeds a photo, a scanned
-- letter or a voice memo reads wrong on its web page without it. This
-- migration makes the place for those files; the sync fills it in later steps
-- (#1300 lists them on a scan, #1301 copies them, #1302 shows them, #1303
-- removes them when an account or a vault goes).
--
-- What is kept. Images (png, jpg, jpeg, gif, webp), PDFs and audio (mp3, m4a,
-- wav, ogg). SVG is left out because a browser runs the script inside one,
-- and video and canvas files are left out by the feature's brief.
--
-- 1. obsidian.attachments
--
-- One row per kept file in the vault, keyed by connection and repository
-- path, as notes are. blob_sha is git's content hash, so an unchanged file is
-- never fetched twice. storage_path is where the copy is in the bucket, and
-- is null until the sync has copied it. A file over 50 MB keeps its row, so
-- the note page can say it is too large, and never gets a storage_path.
--
-- The sync writes this table through the service role. The owner may read
-- their own rows and write none: this is a mirror of the repository, and the
-- app is never the writer of a vault.
--
-- 2. The vault-attachments bucket
--
-- Written the way goals 0011 writes goals-documents:
--
--   path       <user id>/<connection id>/<blob sha>
--   read       your own folder only
--   write      the service role only
--
-- The path is by content rather than by file name, so a rename in the vault
-- needs no new copy, and two paths holding the same file share one. Nothing
-- is served from the bucket directly: the note page signs a short-lived URL
-- for a file in the reader's own folder. The bucket is private, so there is
-- no public URL to any file in it.
--
-- The bucket half is skipped where there is no storage schema, which is the
-- local test database, as for goals-documents and learn-transcripts.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table obsidian.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references obsidian.vault_connections (id) on delete cascade,

  -- Repo-relative, extension included, no leading slash, as notes.path.
  path text not null,
  blob_sha text not null check (blob_sha <> ''),
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text not null check (mime_type in (
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg'
  )),
  -- Where the copy is in vault-attachments. Null until copied, and always
  -- null for a file over 50 MB, which is kept as a row and never copied.
  storage_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attachments_path_ck check (path <> '' and path !~ '^/'),
  constraint attachments_too_large_not_stored_ck
    check (storage_path is null or size_bytes <= 52428800),
  constraint attachments_storage_path_in_own_folder_ck
    check (storage_path is null or storage_path like user_id::text || '/%'),
  constraint attachments_connection_path_key unique (connection_id, path)
);

comment on table obsidian.attachments is
  'Images, PDFs and audio in the vault, one row per file, with where its private copy is kept in the vault-attachments bucket (plan #1299).';

create index attachments_user_idx on obsidian.attachments (user_id);

create trigger attachments_touch_updated_at
  before update on obsidian.attachments
  for each row execute function obsidian.touch_updated_at();

-- The same guard as notes: the denormalised owner must be the connection's.
-- The function checks new.user_id against new.connection_id and nothing else.
create trigger attachments_owner_matches_connection
  before insert or update of user_id, connection_id on obsidian.attachments
  for each row execute function obsidian.notes_owner_matches_connection();

alter table obsidian.attachments enable row level security;

create policy attachments_select on obsidian.attachments for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on obsidian.attachments from anon, authenticated;
grant select on obsidian.attachments to authenticated;
grant select, insert, update, delete on obsidian.attachments to service_role;

-- ---------------------------------------------------------------------------
-- 2. The bucket.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the vault-attachments bucket. Expected on the local test database.';
    return;
  end if;

  -- 50 MB, the size above which a file is shown as too large rather than
  -- copied. The types are the table's.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'vault-attachments',
    'vault-attachments',
    false,
    52428800,
    array[
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/pdf',
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/ogg'
    ]
  )
  on conflict (id) do nothing;

  -- Read only. The sync uploads and removes with the service role, which
  -- bypasses these policies, so a signed-in account has no write policy here
  -- and cannot plant or remove a file even in its own folder.
  execute $p$
    create policy vault_attachments_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'vault-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;
