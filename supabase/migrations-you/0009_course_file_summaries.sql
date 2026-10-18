-- Dash's summary of one course file (plan #2401.4, under #2401).
--
-- Pressing Summarise on a file kept under a course (you.course_files) has
-- Dash read it once and write a short summary and up to five points worth
-- keeping. They are kept here, one row per file, so the file is not read
-- again to show them. A second press replaces the row. A read that fails
-- writes nothing.
--
-- summary is a few sentences. points holds one to five lines. model is the
-- model that read the file, and read_at when it did.
--
-- A summary belongs to a file of the same owner and goes with the file,
-- which goes with its course.

set search_path = you, public, extensions;

-- The composite key the summary's foreign key needs, so a summary can only
-- sit under a file of its own owner.
alter table you.course_files
  add constraint course_files_id_user_id_key unique (id, user_id);

create table you.course_file_summaries (
  file_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  summary text not null check (btrim(summary) <> '' and char_length(summary) <= 2000),
  points text[] not null check (
    cardinality(points) between 1 and 5
    and array_position(points, null) is null
    and char_length(array_to_string(points, '')) <= 2500
  ),
  model text not null check (btrim(model) <> '' and char_length(model) <= 100),
  read_at timestamptz not null default now(),

  foreign key (file_id, user_id)
    references you.course_files (id, user_id) on delete cascade
);

comment on table you.course_file_summaries is
  'Dash''s summary and up to five key points for one course file, written when the person presses Summarise on it; a second press replaces it (plan #2401.4).';

create index course_file_summaries_user_idx on you.course_file_summaries (user_id);

alter table you.course_file_summaries enable row level security;

create policy course_file_summaries_all on you.course_file_summaries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.course_file_summaries from anon, authenticated;
grant select, insert, update, delete on you.course_file_summaries to authenticated, service_role;

notify pgrst, 'reload schema';
