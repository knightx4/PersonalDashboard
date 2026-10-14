-- Research briefs for topics (plan #2023.1; feature #2023 "Research a topic
-- when you ask Dash").
--
-- learn.briefs, one row per topic the person asked Dash to research:
--   track_id       the reading list the sources go on. Null once the list is
--                  deleted; the brief stays.
--   question       what they want to learn, in their words.
--   angle          why they want it, a sentence or two ('' when unknown).
--   depth          quick, standard or deep: how much searching the run does.
--   sub_questions  [{id, text}]: the three to five questions the run framed.
--   status         researching, ready or failed; error says why it failed.
--   sections       [{sub_question_id, position, citations: [{reading_id,
--                  quote}]}]: per sub-question the answer and the quoted words,
--                  each naming the reading they came from.
--   short_answer   about 150 words from the person's angle.
--   short_answer_by  'dash' until the person edits it, then 'you'.
--   watch_on       whether the weekly check looks for new sources.
--   watched_at     when it last looked; quiet_checks counts checks in a row
--                  that found nothing (four moves it to monthly).
--   archived_at    set when the person archives it.
-- It holds what the person wants to know, so it is a source (lib/learn/sources.ts).
--
-- learn.readings gains brief_id (the brief that found it), found_at and
-- found_kind (what sort of publisher: regulator, professional_body, firm,
-- press, vendor).

set search_path = learn, public, extensions;

create table if not exists learn.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid,
  question text not null,
  angle text not null default '',
  depth text not null default 'standard',
  sub_questions jsonb not null default '[]'::jsonb,
  status text not null default 'researching',
  error text,
  sections jsonb not null default '[]'::jsonb,
  short_answer text not null default '',
  short_answer_by text not null default 'dash',
  watch_on boolean not null default true,
  watched_at timestamptz,
  quiet_checks integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint briefs_id_user_uq unique (id, user_id),
  constraint briefs_track_fk
    foreign key (track_id, user_id) references learn.tracks (id, user_id)
    on delete set null (track_id),
  constraint briefs_question_ck check (btrim(question) <> '' and length(question) <= 500),
  constraint briefs_depth_check check (depth in ('quick', 'standard', 'deep')),
  constraint briefs_status_check check (status in ('researching', 'ready', 'failed')),
  constraint briefs_short_answer_by_check check (short_answer_by in ('dash', 'you')),
  constraint briefs_quiet_checks_ck check (quiet_checks >= 0),
  constraint briefs_sub_questions_array check (jsonb_typeof(sub_questions) = 'array'),
  constraint briefs_sections_array check (jsonb_typeof(sections) = 'array')
);

create index if not exists briefs_user_open_idx
  on learn.briefs (user_id, created_at desc) where archived_at is null;

create index if not exists briefs_track_idx
  on learn.briefs (track_id) where track_id is not null;

alter table learn.briefs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'briefs' and policyname = 'briefs_all'
  ) then
    create policy briefs_all on learn.briefs for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.briefs from anon, authenticated;
grant select, insert, update, delete on learn.briefs to authenticated, service_role;

alter table learn.readings
  add column if not exists brief_id uuid,
  add column if not exists found_at timestamptz,
  add column if not exists found_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'readings_brief_fk') then
    alter table learn.readings
      add constraint readings_brief_fk
      foreign key (brief_id, user_id) references learn.briefs (id, user_id)
      on delete set null (brief_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'readings_found_kind_check') then
    alter table learn.readings
      add constraint readings_found_kind_check
      check (found_kind is null or found_kind in ('regulator', 'professional_body', 'firm', 'press', 'vendor'));
  end if;
end;
$$;

create index if not exists readings_brief_idx
  on learn.readings (brief_id) where brief_id is not null;

comment on table learn.briefs is
  'A topic the person asked Dash to research: the question, why, the sub-questions, cited answers and a short version (plan #2023.1).';
comment on column learn.readings.brief_id is
  'The research brief that found this reading, when one did (plan #2023.1).';
comment on column learn.readings.found_kind is
  'Who published it, as the research run labelled it: regulator, professional_body, firm, press or vendor (plan #2023.1).';
