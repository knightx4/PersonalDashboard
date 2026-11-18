-- The recruiting platform a role is posted on, typed by the person: Ashby,
-- Greenhouse, Workday, the company's own site (in_house) and so on.
--
-- Kept on the role rather than in companies.ats_type, because a company can
-- post through more than one system and ats_type drives the board readers.
-- Null when not typed; the role page then shows what the posting link says
-- (lib/jobs/roles/platform.ts). No existing row changes.

alter table job_search.roles
  add column posting_platform text,
  add constraint roles_posting_platform_ck check (
    posting_platform is null or posting_platform in (
      'ashby', 'greenhouse', 'lever', 'workday', 'icims', 'smartrecruiters', 'workable',
      'recruitee', 'breezy', 'bamboohr', 'rippling', 'taleo', 'jobvite', 'wellfound',
      'linkedin', 'indeed', 'in_house', 'other'
    )
  );
