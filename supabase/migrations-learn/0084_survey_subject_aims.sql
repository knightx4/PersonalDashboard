-- Hidden subjects that hold Practice Flow questions about a learning goal.
--
-- Plan #1382 has Practice Flow ask about your learning goals (learn.aims) as
-- well as your tracks and vault themes. A goal's questions go where a vault
-- theme's already do (0040_survey_subjects.sql): a learn subject marked
-- `survey`, which every list of tracks leaves out, with one idea per
-- question. This links that subject to its goal.
--
--   aim_id   the goal the subject was made for. At most one subject per goal,
--            so "the subject for goal X" has one answer. Kept if a real track
--            with the same name later takes the subject over. When the goal is
--            deleted the link is cleared and the subject, with its answers,
--            stays hidden.
--
-- The foreign key is on (aim_id, user_id), as theme_id's is, so a subject can
-- never point at another account's goal. learn.aims had no unique key on that
-- pair, so it gets one here.

set search_path = learn, public, extensions;

alter table learn.aims drop constraint if exists aims_id_user_uq;
alter table learn.aims add constraint aims_id_user_uq unique (id, user_id);

alter table learn.subjects
  add column if not exists aim_id uuid;

alter table learn.subjects drop constraint if exists subjects_aim_fk;
alter table learn.subjects
  add constraint subjects_aim_fk
    foreign key (aim_id, user_id) references learn.aims (id, user_id)
    on delete set null (aim_id);

create unique index if not exists subjects_user_aim_uq
  on learn.subjects (user_id, aim_id)
  where aim_id is not null;
