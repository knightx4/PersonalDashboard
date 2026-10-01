-- Which courses from a transcript have been read into Learn (plan #1389, under #1388).
--
-- The Tracks page gives each course saved in the vault's Education tab
-- (obsidian.courses, vault 0030) a button that has Dash list the ideas a
-- course by that name usually teaches, for the person to keep as known. This
-- table is the note Learn keeps of each course it has read that way, so the
-- list can show which are done, which track each went into, and which are
-- left.
--
-- learn.course_reads, one row per course read:
--   course_id       the course in obsidian.courses. A course is read once;
--                   reading it again updates the same row.
--   subject_id      the track (learn.subjects) its ideas went into. Cleared
--                   if the track is deleted, so the course still shows as
--                   read.
--   concepts_added  how many ideas were kept as known.
--   read_at         when it was read.
--
-- Deleting a course in the vault, or the transcript it came from, deletes its
-- read record: learn already references obsidian (0031, 0040), so this is a
-- foreign key with on delete cascade rather than a cleanup in the vault's
-- delete path. Both keys are on (id, user_id), so a record can never point at
-- another account's course or track. obsidian.courses had no unique key on
-- that pair, so it gets one here, as 0084 did for learn.aims.
--
-- Bookkeeping, not something the person wrote: listed as not a source in
-- lib/learn/sources.ts.

set search_path = learn, public, extensions;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'obsidian.courses'::regclass and conname = 'courses_id_user_uq'
  ) then
    alter table obsidian.courses add constraint courses_id_user_uq unique (id, user_id);
  end if;
end;
$$;

create table if not exists learn.course_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null,
  subject_id uuid,
  concepts_added integer not null default 0,
  read_at timestamptz not null default now(),

  constraint course_reads_course_fk
    foreign key (course_id, user_id) references obsidian.courses (id, user_id)
    on delete cascade,
  constraint course_reads_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id)
    on delete set null (subject_id),
  constraint course_reads_user_course_uq unique (user_id, course_id),
  constraint course_reads_concepts_added_ck check (concepts_added >= 0)
);

create index if not exists course_reads_subject_idx
  on learn.course_reads (subject_id)
  where subject_id is not null;

alter table learn.course_reads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'course_reads' and policyname = 'course_reads_all'
  ) then
    create policy course_reads_all on learn.course_reads for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.course_reads from anon, authenticated;
grant select, insert, update, delete on learn.course_reads to authenticated;
grant select, insert, update, delete on learn.course_reads to service_role;

comment on table learn.course_reads is
  'Each transcript course read into Learn, with the track its ideas went into and when (plan #1389).';
