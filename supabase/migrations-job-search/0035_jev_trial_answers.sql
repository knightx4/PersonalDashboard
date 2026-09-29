-- Jev's answers on stored job email, for the pilot (plan #1165).
--
-- Feature #1161 moves job-email triage from Haiku to Jev, TypeSafe's
-- classifier, but only if Jev labels this mailbox about as well as Haiku did.
-- The trial job (inngest/jobs/cron/jev-trial.ts) reads a sample of the mail
-- the inbox has already labelled, fetches each body from Gmail again, asks Jev
-- the same eleven-label question plus "other", and writes one row here per
-- message. The write-up in docs/trials/ is read off these rows.
--
--   stored_label       the ledger's label when the trial ran (Tier A's where
--                      it was sure, otherwise Haiku's, after the rejection
--                      rule in reconcileClassification)
--   stored_confidence  Haiku's own confidence, where Haiku ran
--   hand_label         the label the person gave it by hand, where they did;
--                      today that is only "not a real pursuit" on the pipeline
--   tier_a_label/tier  the rules' reading of the same body now, so the write-up
--                      can separate mail Haiku decided from mail the rules did
--   jev_*              Jev's choice, its confidence and every label's
--                      probability, or `failure` when it gave none
--
-- No body, subject or sender is stored: the ledger never keeps the body, and
-- the subject is already on core.ingested_messages where it has not been
-- scrubbed. One row per trial and message, so a rerun resumes rather than
-- repeating. Bookkeeping, so lib/jobs/sources.ts lists it as not a source.

set search_path = job_search, extensions;

create table if not exists jev_trial_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trial text not null,
  message_id uuid not null references ingested_messages (id) on delete cascade,
  stored_label text not null,
  stored_confidence numeric,
  hand_label text,
  tier_a_label text,
  tier_a_tier text,
  jev_label text,
  jev_confidence numeric check (jev_confidence between 0 and 1),
  jev_probabilities jsonb,
  jev_model text,
  failure text,
  created_at timestamptz not null default now(),
  unique (trial, message_id),
  check ((jev_label is null) <> (failure is null))
);

create index if not exists jev_trial_answers_user_trial on jev_trial_answers (user_id, trial);

alter table jev_trial_answers enable row level security;

drop policy if exists jev_trial_answers_select on jev_trial_answers;
create policy jev_trial_answers_select on jev_trial_answers for select to authenticated
  using (user_id = (select auth.uid()));

grant select on jev_trial_answers to authenticated;
grant all on jev_trial_answers to service_role;
revoke all on jev_trial_answers from anon;

comment on table jev_trial_answers is
  'Jev''s label for each stored job email in a trial, beside the stored label, for the Jev pilot (plan #1165).';

notify pgrst, 'reload schema';
