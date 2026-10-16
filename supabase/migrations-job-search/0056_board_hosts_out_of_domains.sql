-- Job-board hosts out of companies.domains.
--
-- `domains` is what an email's sender is matched against, so it has to hold
-- the employer's own domains. A careers link on jobs.ashbyhq.com, a Greenhouse
-- board or a Built In listing put that host there instead: 28 companies held
-- one, and Heron Data held nothing else, so mail from herondata.io matched a
-- second Heron row instead and opened a new role there.
--
-- is_shared_host(host, company_name) says whether a host is a board or job
-- site rather than an employer. The company's own name lets Rippling keep
-- rippling.com and Google keep google.com. It mirrors isSharedHost in
-- lib/jobs/companies/same-company.ts.
--
-- The cleanup takes those hosts out of every company's domains and adds the
-- website's domain where the row has one and it is missing.

set search_path = job_search, extensions;

create or replace function job_search.is_shared_host(p_host text, p_company_name text default null)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_host ~* '(^|\.)(greenhouse\.io|greenhouse-mail\.io|lever\.co|ashbyhq\.com|myworkday\.com|myworkdayjobs\.com|workday\.com|icims\.com|smartrecruiters\.com|workable\.com|workablemail\.com|taleo\.net|oraclecloud\.com|jobvite\.com|bamboohr\.com|breezy\.hr|recruitee\.com|rippling\.com|wellfound\.com|angel\.co|linkedin\.com|indeed\.com|glassdoor\.com|gem\.com|dover\.com|dover\.io|pinpointhq\.com|teamtailor\.com|applytojob\.com|jazzhr\.com|paylocity\.com|ultipro\.com|adp\.com|ycombinator\.com|workatastartup\.com|welcometothejungle\.com|otta\.com|notion\.site|google\.com|builtin[a-z]*\.com)$'
    and not coalesce(
      p_host ~* ('(^|\.)' || pg_catalog.regexp_replace(pg_catalog.lower(p_company_name), '[^a-z0-9]', '', 'g') || '\.[a-z.]+$'),
      false
    )
$$;

update job_search.companies c set
  domains = array(
    select distinct d from pg_catalog.unnest(
      array(select d from pg_catalog.unnest(c.domains) as d where not job_search.is_shared_host(d, c.name))
      || case
           when site.host is not null and not job_search.is_shared_host(site.host, c.name) then array[site.host]
           else '{}'::text[]
         end
    ) as d
    order by d
  )
from (
  select id, case when host ~ '^[a-z0-9.-]+\.[a-z]{2,}$' then host end as host
  from (
    select id, lower(regexp_replace(trim(website), '^(https?://)?(www\.)?([^/:?#]+).*$', '\3', 'i')) as host
    from job_search.companies
  ) parsed
) site
where site.id = c.id
  and (
    exists (select 1 from pg_catalog.unnest(c.domains) as d where job_search.is_shared_host(d, c.name))
    or (site.host is not null and not job_search.is_shared_host(site.host, c.name) and not site.host = any(c.domains))
  );

notify pgrst, 'reload schema';
