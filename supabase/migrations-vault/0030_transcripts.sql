-- Academic transcripts, the courses read from them, and the private bucket the
-- original files live in (plan #1306, under #1304).
--
-- The vault's Education tab takes a transcript as the person already has it,
-- as a PDF, a Word document, a photo or pasted text, keeps the original, and
-- lists every course on it with its school, term, grade and credits. Later
-- steps read the courses out of the file (#1307), show and edit them (#1308)
-- and give them to Dash (#1309). This migration makes the place for them.
--
-- 1. obsidian.transcripts
--
-- One row per uploaded transcript. school is the school that issued it.
-- file_name is the name the person gave the file, and storage_path is where
-- the original is kept in the vault-transcripts bucket. Pasted text is kept
-- as a text/plain file like any other upload, so every transcript has a file
-- to open.
--
-- 2. obsidian.courses
--
-- One row per course on a transcript, in the order it was read (position).
-- school is kept on each course because one transcript can list several, as
-- when transfer credit is shown on the receiving school's record. term, year,
-- credits and grade are as written and may be missing: a transfer credit
-- often has no grade. A course cascades with its transcript and can only
-- belong to a transcript of the same owner.
--
-- Unlike the rest of the vault, these rows are the person's own, not a
-- mirror of the repository, so the owner reads and writes them on the
-- session client.
--
-- 3. The vault-transcripts bucket
--
-- Written the way goals 0011 writes goals-documents:
--
--   path       <user id>/<a fresh uuid>-<the file's name>
--   read       your own folder only
--   write      your own folder only, and never over an existing file
--   delete     your own folder only
--
-- The folder test is obsidian.transcript_file_is_own, so the local test
-- database, which has no storage schema, can check the same rule the bucket
-- policies apply. Nothing is served from the bucket directly: the Education
-- tab signs a short-lived URL for a file in the reader's own folder.
--
-- Deleting a transcript takes its courses with it here; the file does not
-- cascade with the row, so whoever deletes a transcript removes the file as
-- well (lib/vault/transcripts.ts).
--
-- The bucket half is skipped where there is no storage schema, as for
-- goals-documents and vault-attachments.

set search_path = obsidian, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Transcripts.
-- ---------------------------------------------------------------------------
create table obsidian.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  school text not null check (btrim(school) <> '' and char_length(school) <= 200),
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  storage_path text not null,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  )),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 20971520),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transcripts_storage_path_in_own_folder_ck
    check (storage_path like user_id::text || '/_%'),
  constraint transcripts_storage_path_key unique (storage_path),
  unique (id, user_id)
);

comment on table obsidian.transcripts is
  'Academic transcripts the person uploaded, with where each original is kept in the vault-transcripts bucket (plan #1306).';

create index transcripts_user_uploaded_idx
  on obsidian.transcripts (user_id, uploaded_at desc);

create trigger transcripts_touch_updated_at
  before update on obsidian.transcripts
  for each row execute function obsidian.touch_updated_at();

alter table obsidian.transcripts enable row level security;

create policy transcripts_select on obsidian.transcripts for select to authenticated
  using (user_id = (select auth.uid()));

create policy transcripts_insert on obsidian.transcripts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy transcripts_update on obsidian.transcripts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy transcripts_delete on obsidian.transcripts for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on obsidian.transcripts from anon, authenticated;
grant select, insert, update, delete on obsidian.transcripts to authenticated;
grant select, insert, update, delete on obsidian.transcripts to service_role;

-- ---------------------------------------------------------------------------
-- 2. Courses.
-- ---------------------------------------------------------------------------
create table obsidian.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transcript_id uuid not null,
  school text not null check (btrim(school) <> '' and char_length(school) <= 200),
  code text check (code is null or char_length(code) <= 50),
  title text not null check (btrim(title) <> '' and char_length(title) <= 300),
  term text check (term is null or char_length(term) <= 50),
  year integer check (year is null or year between 1900 and 2200),
  credits numeric(6, 2) check (credits is null or credits >= 0),
  grade text check (grade is null or char_length(grade) <= 20),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (transcript_id, user_id)
    references obsidian.transcripts (id, user_id) on delete cascade
);

comment on table obsidian.courses is
  'Each course read from a transcript, with its school, term, credits and grade as written (plan #1306).';

create index courses_transcript_position_idx on obsidian.courses (transcript_id, position);
create index courses_user_idx on obsidian.courses (user_id);

create trigger courses_touch_updated_at
  before update on obsidian.courses
  for each row execute function obsidian.touch_updated_at();

alter table obsidian.courses enable row level security;

create policy courses_select on obsidian.courses for select to authenticated
  using (user_id = (select auth.uid()));

create policy courses_insert on obsidian.courses for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy courses_update on obsidian.courses for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy courses_delete on obsidian.courses for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on obsidian.courses from anon, authenticated;
grant select, insert, update, delete on obsidian.courses to authenticated;
grant select, insert, update, delete on obsidian.courses to service_role;

-- ---------------------------------------------------------------------------
-- 3. The bucket.
-- ---------------------------------------------------------------------------

-- Whether a storage object's name sits in the caller's own folder: the first
-- path segment is their user id and there is a file name after it. The same
-- test as storage.foldername(name)[1] = auth.uid() in goals 0011, written
-- without the storage schema so the local tests can call it.
create or replace function obsidian.transcript_file_is_own(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select object_name is not null
    and position('/' in object_name) > 0
    and split_part(object_name, '/', 1) = (select auth.uid())::text
    and split_part(object_name, '/', 2) <> '';
$$;

revoke all on function obsidian.transcript_file_is_own(text) from public, anon;
grant execute on function obsidian.transcript_file_is_own(text) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the vault-transcripts bucket. Expected on the local test database.';
    return;
  end if;

  -- 20 MB, as for goals-documents: a scanned transcript runs to a few
  -- megabytes. The types are the table's.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'vault-transcripts',
    'vault-transcripts',
    false,
    20971520,
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]
  )
  on conflict (id) do nothing;

  execute $p$
    create policy vault_transcripts_select on storage.objects
      for select to authenticated
      using (bucket_id = 'vault-transcripts' and obsidian.transcript_file_is_own(name))
  $p$;

  execute $p$
    create policy vault_transcripts_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'vault-transcripts' and obsidian.transcript_file_is_own(name))
  $p$;

  execute $p$
    create policy vault_transcripts_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'vault-transcripts' and obsidian.transcript_file_is_own(name))
  $p$;
end;
$$;
