-- Jev's fit and chance scores on each open application (plan #1203).
--
-- The same two numbers the openings on Roles carry (migration 0037, plan
-- #1202): how much of the job the person's evidence covers, and the chance of
-- reaching an interview. The daily suggestion run scores the open
-- applications (every status but rejected, withdrawn, ghosted and
-- role_closed) that have no score yet. lib/jobs/suggest/application-scores.ts
-- holds the questions and reads this back.
--
--   scores        {"fit_score": {"value": 0..100, "confidence": 0..1},
--                  "chance": {…}}; a question Jev gave no readable answer to
--                  is left out
--   scored_at     when it was scored; null means not yet, and the run picks
--                  it up
--   score_model   the Jev version that answered
--
-- When a role's description, extracted requirements or requirement match
-- changes, the trigger below clears scored_at on its applications so the next
-- run scores them again. The old scores stay until then.
--
-- Columns on applications, which lib/jobs/sources.ts already lists as a
-- source, so the catalogue does not change.

set search_path = job_search, extensions;

alter table applications add column if not exists scores jsonb;
alter table applications add column if not exists scored_at timestamptz;
alter table applications add column if not exists score_model text;

alter table applications drop constraint if exists applications_scores_object_ck;
alter table applications add constraint applications_scores_object_ck
  check (scores is null or jsonb_typeof(scores) = 'object');

-- The run's read: open applications not yet scored.
create index if not exists applications_user_unscored_idx
  on applications (user_id, created_at desc)
  where scored_at is null
    and status not in ('rejected', 'withdrawn', 'ghosted', 'role_closed');

create or replace function job_search.clear_application_scores_on_role_change()
returns trigger
language plpgsql
set search_path = job_search
as $$
begin
  if new.jd_text is distinct from old.jd_text
     or new.requirements is distinct from old.requirements
     or new.requirement_matches is distinct from old.requirement_matches then
    update job_search.applications
       set scored_at = null
     where role_id = new.id
       and user_id = new.user_id
       and scored_at is not null;
  end if;
  return null;
end;
$$;

revoke all on function job_search.clear_application_scores_on_role_change() from public, anon, authenticated;

drop trigger if exists roles_clear_application_scores on job_search.roles;
create trigger roles_clear_application_scores
  after update of jd_text, requirements, requirement_matches on job_search.roles
  for each row execute function job_search.clear_application_scores_on_role_change();

notify pgrst, 'reload schema';
