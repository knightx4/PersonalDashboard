-- What a Claude chat adds to Learn (plan #1807, under #1805).
--
-- The connector can now write to Learn for the person (#1808): a reading list
-- pasted into a chat, a record of what a conversation covered, and a reading
-- marked done. This adds what those writes need.
--
-- learn.reading_subjects, one row per reading and subject it relates to:
--   reading_id   the reading (learn.readings). Removed with it.
--   subject_id   a subject it relates to (learn.subjects). Removed with it.
--   user_id      whose, the same person as both.
--   created_at   when it was related.
-- A reading stands on its own and can relate to any number of subjects, so a
-- subject's reading list is the readings related to it, wherever each was
-- added. A join row, not something the person wrote: listed as not a source.
--
-- learn.learning_log, one row per conversation Claude recorded:
--   subject_id   the subject it covered most, or null once that is deleted.
--   topic        what it was about, in a few words.
--   question     what the person was trying to understand, when Claude gave it.
--   summary      what was covered, in a few sentences.
--   ideas        the ideas it named, as [{ "name", "claim" }], at most twelve.
--   created_at   when it was recorded.
-- This records exposure and credits nothing: the ideas are added to the
-- subject's graph as concepts with origin 'conversation' and no state, so
-- they start unknown and move only when the person answers a probe
-- (KNOWLEDGE-SPEC, "Everything starts unknown"). A source of what they did.
--
-- learn.readings.find_after: set when a reading added from a chat still needs
-- its link found, cleared once the lookup has been tried, found or not. The
-- hourly tick picks up any whose lookup did not run after the reply.
--
-- learn.concept_origin gains 'conversation'. Nothing in this file uses it,
-- which Postgres refuses inside the transaction that adds it.

set search_path = learn, public, extensions;

alter type learn.concept_origin add value if not exists 'conversation';

alter table learn.readings add column if not exists find_after timestamptz;

create index if not exists readings_find_after_idx
  on learn.readings (find_after) where find_after is not null;

create table if not exists learn.reading_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reading_id uuid not null references learn.readings (id) on delete cascade,
  subject_id uuid not null,
  created_at timestamptz not null default now(),

  constraint reading_subjects_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id)
    on delete cascade,
  constraint reading_subjects_reading_subject_uq unique (reading_id, subject_id)
);

-- A subject's reading list reads its reading ids by person and subject.
create index if not exists reading_subjects_user_subject_idx
  on learn.reading_subjects (user_id, subject_id);

create index if not exists reading_subjects_subject_idx
  on learn.reading_subjects (subject_id);

alter table learn.reading_subjects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'reading_subjects' and policyname = 'reading_subjects_all'
  ) then
    create policy reading_subjects_all on learn.reading_subjects for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.reading_subjects from anon, authenticated;
grant select, insert, update, delete on learn.reading_subjects to authenticated;
grant select, insert, update, delete on learn.reading_subjects to service_role;

comment on table learn.reading_subjects is
  'Each subject a reading relates to, one row per reading and subject (plan #1807).';

create table if not exists learn.learning_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid references learn.subjects (id) on delete set null,
  topic text not null,
  question text,
  summary text not null,
  ideas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),

  constraint learning_log_topic_ck check (btrim(topic) <> '' and char_length(topic) <= 200),
  constraint learning_log_question_ck check (question is null or char_length(question) <= 2000),
  constraint learning_log_summary_ck check (btrim(summary) <> '' and char_length(summary) <= 4000),
  constraint learning_log_ideas_ck check (jsonb_typeof(ideas) = 'array' and jsonb_array_length(ideas) <= 12)
);

-- A subject's page and the learning_covered lookup read newest first.
create index if not exists learning_log_user_created_idx
  on learn.learning_log (user_id, created_at desc);

create index if not exists learning_log_subject_idx
  on learn.learning_log (subject_id) where subject_id is not null;

alter table learn.learning_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'learning_log' and policyname = 'learning_log_all'
  ) then
    create policy learning_log_all on learn.learning_log for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.learning_log from anon, authenticated;
grant select, insert, update, delete on learn.learning_log to authenticated;
grant select, insert, update, delete on learn.learning_log to service_role;

comment on table learn.learning_log is
  'What a conversation with Claude covered, recorded through the connector (plan #1807). Exposure, never a knowledge claim.';
