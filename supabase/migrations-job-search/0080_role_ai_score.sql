-- How much a role involves AI work, typed by the person: a whole number from
-- 0 to 100, beside fit and chance on the Pipeline table. Set by hand on the
-- role page or through Dash's change_role; nothing computes it.
--
-- Nullable, and no existing row changes: a role nobody has scored shows a dash.

alter table job_search.roles
  add column ai_score smallint,
  add constraint roles_ai_score_ck check (ai_score is null or ai_score between 0 and 100);
