-- What a course was about, pulled together from its file summaries (plan
-- #2401.7, under #2401).
--
-- Once at least two of a course's files have been summarised
-- (you.course_file_summaries), pressing "Pull it together" has Dash read
-- those summaries and their key points and write what the course was about
-- and the ideas that came back in more than one lecture or reading. It is
-- kept here, one row per course, so the course shows it without a second
-- read. A second press replaces the row. A read that fails writes nothing.
--
-- about is a few sentences. recurring is a list of up to eight ideas, each
-- {"idea": text, "file_ids": [uuid, ...]} naming the files it came back in.
-- file_ids is every file whose summary was read, so the course can say how
-- many of its files the overview stands on and which summaries came later.
-- model is the model that read them, and read_at when it did.
--
-- The person's own vault notes about the course are not kept here: the page
-- finds them each time by the course's code or title in their text.
--
-- An overview belongs to a course of the same owner and goes with it.

set search_path = you, public, extensions;

create table you.course_overviews (
  course_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  about text not null check (btrim(about) <> '' and char_length(about) <= 1500),
  recurring jsonb not null default '[]'::jsonb check (
    jsonb_typeof(recurring) = 'array' and jsonb_array_length(recurring) <= 8
  ),
  file_ids uuid[] not null check (
    cardinality(file_ids) between 2 and 20 and array_position(file_ids, null) is null
  ),
  model text not null check (btrim(model) <> '' and char_length(model) <= 100),
  read_at timestamptz not null default now(),

  foreign key (course_id, user_id)
    references you.courses (id, user_id) on delete cascade
);

comment on table you.course_overviews is
  'What a course was about and the ideas that recurred across its files, written by Dash from the file summaries when the person presses for it; a second press replaces it (plan #2401.7).';

create index course_overviews_user_idx on you.course_overviews (user_id);

alter table you.course_overviews enable row level security;

create policy course_overviews_all on you.course_overviews for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.course_overviews from anon, authenticated;
grant select, insert, update, delete on you.course_overviews to authenticated, service_role;

notify pgrst, 'reload schema';
