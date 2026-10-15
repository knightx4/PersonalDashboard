-- Two marks on an application (feature #2102).
--
--   ready_to_apply    true once you have ticked the role as ready to apply.
--                     False by default.
--   has_cover_letter  whether the application has a cover letter: true for
--                     yes, false for no, null until you have answered. It is
--                     your own answer and is not derived from
--                     applications.cover_letter, since a letter may be
--                     written outside the app.

set search_path = job_search, extensions;

alter table applications add column if not exists ready_to_apply boolean not null default false;
alter table applications add column if not exists has_cover_letter boolean;

comment on column applications.ready_to_apply is
  'Marked ready to apply by the person. False until ticked.';
comment on column applications.has_cover_letter is
  'The person''s yes/no answer to whether this application has a cover letter; null until answered.';

notify pgrst, 'reload schema';
