-- Jev's and Haiku's reading of the map trial's notes (plan #1168).
--
-- Feature #1161 moves the map sweep's note classifier from Haiku to Jev,
-- TypeSafe's classifier, but only if Jev routes the notes of the 75-note map
-- trial (docs/trials/2026-09-19-map-75-notes.md) at least as well as Haiku.
-- The trial job (inngest/vault/jev-trial.ts) draws the same 75 notes again,
-- asks Jev the rollout's two questions (lib/vault/map/jev-question.ts) and
-- Haiku its own prompt, and writes one row here per note. The write-up is
-- read off these rows.
--
--   not_sent             journal, credential or too_short: nothing was sent
--   excluded             in a folder the sweep leaves out; sent anyway, since
--                        the trial read it
--   reference            'read' where the trial says the note should be read
--                        (lib/vault/map/jev-trial.ts TRIAL_READS), else null
--   reference_evidence   true where the trial named it evidence
--   jev_*                the class, its confidence and every class's
--                        probability, and the probability that it is
--                        evidence; or jev_failure when Jev gave no answer
--   haiku_*              Haiku's class, flag and reason; or haiku_failure
--
-- No body or title is stored. One row per trial and note, so a rerun resumes
-- rather than repeating. Bookkeeping, so lib/vault/sources.ts lists it as not
-- a source.

set search_path = obsidian, public, extensions;

create table if not exists obsidian.jev_trial_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trial text not null,
  note_id uuid not null references obsidian.notes (id) on delete cascade,
  blob_sha text not null,
  not_sent text check (not_sent in ('journal', 'credential', 'too_short')),
  excluded boolean not null default false,
  reference text check (reference in ('read')),
  reference_evidence boolean,
  jev_class text check (jev_class in ('knowledge', 'mixed', 'operational')),
  jev_confidence numeric check (jev_confidence between 0 and 1),
  jev_probabilities jsonb,
  jev_evidence_probability numeric check (jev_evidence_probability between 0 and 1),
  jev_model text,
  jev_failure text,
  haiku_class text check (haiku_class in ('knowledge', 'mixed', 'operational')),
  haiku_evidence boolean,
  haiku_reason text,
  haiku_failure text,
  created_at timestamptz not null default now(),
  unique (trial, note_id),
  check (not_sent is not null or (jev_class is null) <> (jev_failure is null)),
  check (not_sent is not null or (haiku_class is null) <> (haiku_failure is null))
);

create index if not exists jev_trial_answers_user_trial on obsidian.jev_trial_answers (user_id, trial);

alter table obsidian.jev_trial_answers enable row level security;

drop policy if exists jev_trial_answers_select on obsidian.jev_trial_answers;
create policy jev_trial_answers_select on obsidian.jev_trial_answers for select to authenticated
  using (user_id = (select auth.uid()));

grant select on obsidian.jev_trial_answers to authenticated;
grant all on obsidian.jev_trial_answers to service_role;
revoke all on obsidian.jev_trial_answers from anon;

comment on table obsidian.jev_trial_answers is
  'Jev''s and Haiku''s class for each note of the map trial, for the Jev pilot (plan #1168).';

notify pgrst, 'reload schema';
