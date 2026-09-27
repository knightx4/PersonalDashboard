-- The cover letter you send with an application (note b4cecf70).
--
-- The Answers tab on a role is now Application: the questions and your
-- answers to them, and under them the cover letter. It is a column on the
-- application because there is one letter per application and it is yours
-- alone.
--
-- It is not cover_letters.body. That column is the statement of interest on
-- the shared case page, which public_case_page() hands to anyone holding the
-- link; a draft letter kept there would go out the moment the page was
-- shared.

set search_path = job_search, extensions;

alter table applications add column if not exists cover_letter text;

alter table applications drop constraint if exists applications_cover_letter_ck;
alter table applications add constraint applications_cover_letter_ck
  check (cover_letter is null or length(cover_letter) <= 20000);

comment on column applications.cover_letter is
  'The cover letter for this application, private. Not the shared case page''s statement (cover_letters.body).';

notify pgrst, 'reload schema';
