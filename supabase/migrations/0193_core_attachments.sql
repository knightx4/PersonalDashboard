-- Attachments: the files a person adds to a note, a quick capture or a
-- question for Dash, and the private bucket they live in (plan #1712, under
-- feature #1711).
--
-- One store for every place a file can be added, so each place after this is
-- a small step: the top bar's note button (#1713), the quick capture (#1714)
-- and Ask Dash (#1715, #1716). The post-images bucket on the Posts tab is the
-- pattern followed here.
--
-- 1. core.attachments
--
-- One row per file per row it belongs to. `ref` names that row as
-- `schema.table:id` (docs/CORE-AND-DASH-SPEC.md, Part 1), so a file can belong
-- to any row in any module without a foreign key to each. A quick capture
-- that Dash splits into a todo and a goal step records the same `path` twice,
-- once against each, and the copy in storage is shared: it is removed only
-- when no row records it any more (lib/attachments/store.ts).
--
--   path          where the file is in the attachments bucket:
--                 <user id>/<a fresh uuid>-<the file's name, cleaned>.
--   name          the file's name as the person chose it, for the chip.
--   content_type  one of the types the bucket accepts.
--   size_bytes    up to 20 MB, the bucket's own limit.
--
-- Five files to one row at most, which the feature settles. A trigger counts
-- them, under a lock on the row's ref so two uploads at once cannot both take
-- the fifth place.
--
-- The person writes these rows on their own session, from the server action
-- that saves the thing the files came with. They read and delete their own,
-- and nothing updates one: a file is replaced by recording another.
--
-- 2. The attachments bucket
--
-- Written the way goals 0011 writes goals-documents:
--
--   path       <user id>/<a fresh uuid>-<the file's name>
--   read       your own folder only
--   write      your own folder only, and never over an existing file
--   delete     your own folder only
--
-- The browser uploads the file itself, so it never passes through a server
-- action's one-megabyte body. Nothing is served from the bucket directly:
-- /attachments/<id> signs a short link to a file in the reader's own folder.
-- Deleting the account clears the folder (app/api/account/delete).
--
-- The bucket half is skipped where there is no storage schema, which is the
-- local test database, as for goals-documents and vault-attachments.

set search_path = core, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table core.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  path text not null,
  name text not null,
  content_type text not null,
  size_bytes bigint not null,
  ref text not null,

  created_at timestamptz not null default now(),

  constraint attachments_path_in_own_folder_ck
    check (path like user_id::text || '/%' and char_length(path) <= 200),
  constraint attachments_name_ck
    check (btrim(name) <> '' and char_length(name) <= 255),
  constraint attachments_content_type_ck check (content_type in (
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  )),
  constraint attachments_size_ck check (size_bytes between 0 and 20971520),
  constraint attachments_ref_ck
    check (ref ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:.+$' and char_length(ref) <= 200),
  -- The same file is recorded against a row once.
  constraint attachments_path_ref_key unique (path, ref)
);

-- A row's files, in the order they were added.
create index attachments_ref_idx on core.attachments (ref, created_at);
-- Whether any row still records a file, before its copy is removed.
create index attachments_path_idx on core.attachments (path);
create index attachments_user_idx on core.attachments (user_id);

-- Five to a row.
create or replace function core.attachments_per_ref_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.ref, 0));
  if (select count(*) from core.attachments a where a.ref = new.ref) >= 5 then
    raise exception 'A row holds five files at most.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger attachments_per_ref_limit
  before insert on core.attachments
  for each row execute function core.attachments_per_ref_limit();

alter table core.attachments enable row level security;

create policy attachments_select on core.attachments for select to authenticated
  using (user_id = (select auth.uid()));
create policy attachments_insert on core.attachments for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy attachments_delete on core.attachments for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.attachments from anon, authenticated;
grant select, insert, delete on core.attachments to authenticated;
grant all on core.attachments to service_role;

comment on table core.attachments is
  'Files the person added, each recorded against the row it belongs to as schema.table:id; the copy is in the attachments bucket (plan #1712).';
comment on column core.attachments.ref is
  'The row the file belongs to, as schema.table:id. One file recorded against two rows has two rows here with the same path.';

-- ---------------------------------------------------------------------------
-- 2. The bucket.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the attachments bucket. Expected on the local test database.';
    return;
  end if;

  -- 20 MB, and the types the feature settles: images, PDFs, Word, plain
  -- text and CSV.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'attachments',
    'attachments',
    false,
    20971520,
    array[
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv'
    ]
  )
  on conflict (id) do nothing;

  execute $p$
    create policy attachments_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy attachments_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy attachments_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;

notify pgrst, 'reload schema';
