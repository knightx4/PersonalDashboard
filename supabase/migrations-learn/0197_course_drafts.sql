-- A course build's work in progress, kept so a build can stop and pick up.
--
-- A course of fifty lectures took one build three hours and ran into the
-- owner's usage limit twice. Its notes were already stored per lecture
-- (course_lectures.notes), but the plan's design and each stage as it was
-- written lived only in the building session's scratch files, which a
-- restart loses. `draft` holds them:
--
--   {
--     "outline":  the designed plan (stages and steps, each step with a
--                 brief for its writer), as scripts/learn-course.ts
--                 `outline` checked and kept it,
--     "stages":   { "<stage key>": the stage as written, checked },
--     "reviewed": [ the stage keys a second reader has rechecked ]
--   }
--
-- lib/learn/courses/draft.ts reads and checks it; `save` assembles the
-- digest from it. It is bookkeeping for the build, never shown to the person,
-- and is left in place once the course is ready, so a rebuild for a new goal
-- can start from it.
--
-- No rows in any account are read or changed.

alter table learn.courses
  add column if not exists draft jsonb not null default '{}'::jsonb;

comment on column learn.courses.draft is
  'A build''s work in progress: the designed outline, each stage as written, and which stages were rechecked (learn 0197).';
