-- Jev's answers to eight fixed questions about each recommended opening
-- (plan #1178).
--
-- The openings on Roles (suggestions of kind 'apply') are scored by Jev on
-- whether the work is remote, its level, whether pay is given, how well the
-- evidence bank matches it, red flags, whether it asks for a cover letter,
-- whether it is already on file, and how close it is to the roles applied to.
-- lib/jobs/suggest/scores.ts holds the questions and reads this back.
--
--   scores        one entry per question, {"value": …, "confidence": 0..1};
--                 a question Jev gave no readable answer to is left out
--   scored_at     when it was scored; null means not yet, and the run picks
--                 it up
--   score_model   the Jev version that answered
--
-- Columns on suggestions, which lib/jobs/sources.ts already lists as not a
-- source, so the catalogue does not change.

set search_path = job_search, extensions;

alter table suggestions add column if not exists scores jsonb;
alter table suggestions add column if not exists scored_at timestamptz;
alter table suggestions add column if not exists score_model text;

alter table suggestions drop constraint if exists suggestions_scores_object_ck;
alter table suggestions add constraint suggestions_scores_object_ck
  check (scores is null or jsonb_typeof(scores) = 'object');

-- The run's read: open openings not yet scored.
create index if not exists suggestions_user_unscored_idx
  on suggestions (user_id, created_at desc)
  where kind = 'apply' and status = 'open' and scored_at is null;

notify pgrst, 'reload schema';
