-- What a preparation step found, beyond its one-line summary (plan #2276.3).
--
-- The pull step lists each document it stored with its provider and link, and
-- the match step keeps the weeks it found for the territory step to read, so a
-- step needs somewhere to put a list. `detail` holds it as jsonb, written by
-- the step's own code and read by the subject page and by later steps. A
-- column on the existing table: no new table, no existing row changes.

set search_path = learn, public, extensions;

alter table learn.subject_preparation_steps
  add column if not exists detail jsonb not null default '{}'::jsonb;

comment on column learn.subject_preparation_steps.detail is
  'What the step found, as the step''s own code shapes it: documents stored by pull_documents, weeks matched by match_weeks. Counts stay in counts; the one-line summary stays in summary.';
