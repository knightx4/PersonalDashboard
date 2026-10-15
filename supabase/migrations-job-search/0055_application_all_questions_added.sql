-- A third mark on an application (feature #2196).
--
--   all_questions_added  true once you have added every question the
--                        application form asks. False by default.

set search_path = job_search, extensions;

alter table applications add column if not exists all_questions_added boolean not null default false;

comment on column applications.all_questions_added is
  'Marked by the person once every question the application form asks has been added. False until ticked.';

notify pgrst, 'reload schema';
