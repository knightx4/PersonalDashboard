-- Dash's analysis across all of a person's personality tests, on the
-- Personality tab.
--
-- One test read alone says little. Read together, the tests agree on some
-- things and disagree on others, and checking the disagreements against the
-- person's notes and what they do says which describes them. Each run is a
-- row, so earlier analyses are kept; the tab shows the newest. The board and
-- the insights run read the newest too.
--
-- you.personality_profiles:
--   results_key  a fingerprint of the results the analysis was written from
--                (lib/you/personality/profile.ts, profileKey): every result's
--                type, scores, themes, note and date, but not Dash's per-test
--                reads. When the results now give a different key, a test
--                was added, changed or deleted since, and the tab offers to
--                write the analysis again.
--   summary      a short paragraph, to the person.
--   agreements   array of {text, tests}: what several tests say alike.
--   tensions     array of {text, tests, verdict, note?}: where tests
--                disagree, and what the person's notes and record say about
--                which is nearer. note names the vault note it rests on.
--   watch        array of {text, evidence}: a pattern the tests predict,
--                with the number from the person's record that bears on it.
--   model        the model that wrote it, or 'none' when nothing was sent.
--
-- Owner-only. Dash wrote it, so it is not a source for Goals.

set search_path = you, public, extensions;

create table if not exists you.personality_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  results_key text not null,
  summary text not null,
  agreements jsonb not null default '[]'::jsonb,
  tensions jsonb not null default '[]'::jsonb,
  watch jsonb not null default '[]'::jsonb,
  model text not null,
  created_at timestamptz not null default now(),
  constraint personality_profiles_summary_ck check (length(btrim(summary)) between 1 and 2000),
  constraint personality_profiles_shape_ck check (
    jsonb_typeof(agreements) = 'array'
    and jsonb_typeof(tensions) = 'array'
    and jsonb_typeof(watch) = 'array'
  )
);

create index if not exists personality_profiles_user_created_idx
  on you.personality_profiles (user_id, created_at desc);

alter table you.personality_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'you' and tablename = 'personality_profiles'
      and policyname = 'personality_profiles_all'
  ) then
    create policy personality_profiles_all on you.personality_profiles for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on you.personality_profiles from anon, authenticated;
grant select, insert on you.personality_profiles to authenticated;
grant select, insert, update, delete on you.personality_profiles to service_role;

comment on table you.personality_profiles is
  'Dash''s analysis across all of a person''s personality tests: where they agree, where they disagree and what to watch, one row per run.';
