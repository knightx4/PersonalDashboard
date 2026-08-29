-- Recruitee joins the ATS list.
--
-- It publishes its board as JSON on the company's own careers subdomain, so a
-- pasted Recruitee URL now fetches the description instead of falling through
-- to the paste box. The enum is what the role form writes when it detects the
-- vendor from a URL, so the value has to exist before the fetcher is useful.

set search_path = job_search, extensions;

alter type ats_type add value if not exists 'recruitee';
