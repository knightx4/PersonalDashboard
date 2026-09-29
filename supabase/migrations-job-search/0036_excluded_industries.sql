-- Industries the person never wants suggested.
--
-- The postings and people searches read the career goals entries as prose, so
-- "not crypto" written there was a request the model could miss: two crypto
-- postings were suggested the day before it was written and nothing took them
-- out afterwards. This list is a rule. The prompt names it, each suggestion
-- reports its company's industry, and lib/jobs/suggest/payload.ts drops any
-- whose industry, company or title matches an entry.
--
-- Edited on /jobs/settings next to the target titles. A column on profiles,
-- which lib/jobs/sources.ts already lists as a source.

set search_path = job_search, extensions;

alter table profiles
  add column if not exists excluded_industries text[] not null default '{}';
