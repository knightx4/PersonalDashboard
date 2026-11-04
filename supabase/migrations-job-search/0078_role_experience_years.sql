-- The years of experience a role asks for, typed by the person.
--
-- The Experience row on a posting reads a range from the description
-- (lib/jobs/jd/experience.ts). A description can be missing, vague or wrong,
-- so the person can type the years instead, and what they typed wins.
--
--   experience_min_years   the least the role asks for; null when not typed
--   experience_max_years   the most; null for open-ended ("5+ years") or not typed
--
-- Both are nullable and no existing row changes: a role with neither keeps
-- showing the range read from its description.

alter table job_search.roles
  add column experience_min_years smallint,
  add column experience_max_years smallint,
  add constraint roles_experience_years_ck check (
    (experience_min_years is null or experience_min_years >= 0)
    and (experience_max_years is null or experience_max_years >= 0)
    and (
      experience_min_years is null
      or experience_max_years is null
      or experience_max_years >= experience_min_years
    )
  );
