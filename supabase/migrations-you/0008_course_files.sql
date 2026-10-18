-- Files kept under a course (plan #2401.1, under #2401).
--
-- A course on a transcript can hold the files the person kept from it: the
-- syllabus, lecture slides, lecture notes and readings. Later steps upload and
-- list them by week (#2401.2) and have Dash summarise each one (#2401.4).
--
-- 1. you.course_files
--
-- One row per file. kind is what the file is. week is the week of the course
-- it belongs to, or null for one that spans the course, such as the syllabus.
-- position orders the files within a course. title is what the page shows;
-- file_name is the name the file arrived with. storage_path is where it is
-- kept in the you-course-files bucket.
--
-- A file can only belong to a course of the same owner, and cascades with
-- the course, which cascades with its transcript. The storage object does not
-- cascade, so whoever deletes a course or a transcript removes its files from
-- the bucket as well (lib/you/transcripts.ts, deleteCourse and
-- deleteTranscript).
--
-- A course holds at most 20 files. The trigger locks the course row before
-- counting, so two uploads at once cannot both take the twentieth place.
--
-- 2. The you-course-files bucket
--
-- Written the way migrations-vault/0030 writes vault-transcripts:
--
--   path       <user id>/<course id>/<a fresh uuid>-<the file's name>
--   read       your own folder only
--   write      your own folder only, and never over an existing file
--   delete     your own folder only
--
-- 20 MB per file. The types are the transcript types and PowerPoint.
--
-- The folder test is you.course_file_is_own, so the local test database,
-- which has no storage schema, can check the rule the bucket policies apply.
-- The bucket half is skipped where there is no storage schema.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

-- The composite key a file's foreign key needs, so a file can only sit under
-- a course of its own owner.
alter table you.courses
  add constraint courses_id_user_id_key unique (id, user_id);

create table you.course_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null,
  kind text not null check (kind in ('syllabus', 'slides', 'lecture_notes', 'reading')),
  title text not null check (btrim(title) <> '' and char_length(title) <= 300),
  week integer check (week is null or week between 0 and 60),
  position integer not null default 0 check (position >= 0),
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 255),
  storage_path text not null,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  )),
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 20971520),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint course_files_storage_path_in_own_folder_ck
    check (storage_path like user_id::text || '/' || course_id::text || '/_%'),
  constraint course_files_storage_path_key unique (storage_path),

  foreign key (course_id, user_id)
    references you.courses (id, user_id) on delete cascade
);

comment on table you.course_files is
  'Files the person kept from a course: syllabus, slides, lecture notes and readings, each with its week, and where it is kept in the you-course-files bucket (plan #2401.1).';

create index course_files_course_idx
  on you.course_files (course_id, week, position);
create index course_files_user_idx on you.course_files (user_id);

create trigger course_files_touch_updated_at
  before update on you.course_files
  for each row execute function you.touch_updated_at();

-- At most 20 files on one course.
create or replace function you.course_files_within_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  held integer;
begin
  if tg_op = 'UPDATE' and new.course_id = old.course_id then
    return new;
  end if;

  perform 1 from you.courses c where c.id = new.course_id for update;

  select count(*) into held
    from you.course_files f
   where f.course_id = new.course_id;

  if held >= 20 then
    raise exception 'A course holds at most 20 files.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function you.course_files_within_limit() from public, anon, authenticated;

create trigger course_files_within_limit
  before insert or update of course_id on you.course_files
  for each row execute function you.course_files_within_limit();

alter table you.course_files enable row level security;

create policy course_files_all on you.course_files for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.course_files from anon, authenticated;
grant select, insert, update, delete on you.course_files to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The bucket.
-- ---------------------------------------------------------------------------

-- Whether a storage object's name sits in the caller's own folder, under a
-- course folder, with a file name after it.
create or replace function you.course_file_is_own(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select object_name is not null
    and split_part(object_name, '/', 1) = (select auth.uid())::text
    and split_part(object_name, '/', 2) <> ''
    and split_part(object_name, '/', 3) <> '';
$$;

revoke all on function you.course_file_is_own(text) from public, anon;
grant execute on function you.course_file_is_own(text) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the you-course-files bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'you-course-files',
    'you-course-files',
    false,
    20971520,
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain'
    ]
  )
  on conflict (id) do nothing;

  execute $p$
    create policy you_course_files_select on storage.objects
      for select to authenticated
      using (bucket_id = 'you-course-files' and you.course_file_is_own(name))
  $p$;

  execute $p$
    create policy you_course_files_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'you-course-files' and you.course_file_is_own(name))
  $p$;

  execute $p$
    create policy you_course_files_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'you-course-files' and you.course_file_is_own(name))
  $p$;
end;
$$;

notify pgrst, 'reload schema';
