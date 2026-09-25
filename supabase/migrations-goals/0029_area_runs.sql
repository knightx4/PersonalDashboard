-- ===========================================================================
-- Planning an area (docs/GOALS-SPEC.md, "Planning an area").
--
-- Until now a run started from one goal, one step, or a schedule. An area
-- with no goals under it, such as "get plugged into the city", had nothing to
-- press: you had to know the goals before Claude could help with them. A run
-- can now start from an area, and Claude proposes the goals under it.
--
--   areas.note     what you want from the area, in your own words. Optional;
--                  the area run reads it as its brief.
--   runs.job       gains 'area': Plan this area on an area.
--   runs.area_id   the area an 'area' run is on. Null for every other job.
--
-- What an area run may write is what the guard on goals.items already allows
-- Claude (0006): goals go in as proposed, and steps under a goal that is not
-- approved go in as proposed, questions as open. Nothing new is allowed here.
-- ===========================================================================

alter table goals.areas add column note text;

alter table goals.areas add constraint areas_note_ck
  check (note is null or (btrim(note) <> '' and length(note) <= 4000));

comment on column goals.areas.note is
  'What you want from the area, in your own words. The area run (Plan this area) reads it as its brief.';

alter table goals.runs add column area_id uuid;

alter table goals.runs add constraint runs_area_fk foreign key (area_id, user_id)
  references goals.areas (id, user_id) on delete set null (area_id);

alter table goals.runs drop constraint runs_job_ck;
alter table goals.runs add constraint runs_job_ck
  check (job in ('daily', 'weekly', 'goal', 'reshape', 'step', 'phase', 'prepare', 'area'));

alter table goals.runs add constraint runs_area_job_ck
  check (area_id is null or job = 'area');

create index runs_area_idx on goals.runs (area_id) where area_id is not null;

comment on column goals.runs.area_id is
  'The area an area run (job area, Plan this area) proposes goals for. Null for every other job.';

comment on column goals.runs.job is
  'What fired the run: daily (the morning run), weekly (review and research), goal (Work on this, or a comment on a goal), reshape (questions on the goal were answered), step or phase (sent from its row), prepare (one of your steps prepared) or area (Plan this area).';

notify pgrst, 'reload schema';
