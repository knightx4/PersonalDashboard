-- Recommended roles: the posting itself, why one was turned down, where each
-- came from, and what the person wants from a job.
--
-- suggestions (kind 'apply')
--
--   origin              who found it: 'search' (the weekly web search),
--                       'board' (a followed company's own job board, read
--                       before the search) or 'goal' (a goals run, written in
--                       plain SQL). The default is 'goal' because the goals
--                       runs and the goals trigger (goals 0055) are the only
--                       writers that do not name it; lib/jobs/suggest/run.ts
--                       always does. The open-list cap counts only 'search'
--                       and 'board' rows, so goal finds no longer stop the
--                       weekly search.
--   dismiss_reason      why the person turned it down. Fed back into the
--                       next search; 'company' also keeps that company out
--                       of every later search.
--   expired_reason      why Dash took it off the list: the posting 'closed',
--                       it went 'stale' (open three weeks untouched), or Jev
--                       found it a 'duplicate' of a role already on file.
--   posting_text        the description as read from the link, so Jev scores
--                       the posting and not Dash's two-sentence summary.
--   posting_status      what the last read found: 'open', 'closed' or
--                       'unreadable' (the page could not be read; the row
--                       stays and is scored from the summary as before).
--   posting_checked_at  when the link was last read.
--   comp_min_cents,     the pay band and work mode the text states, read by
--   comp_max_cents,     lib/jobs/jd/requirements.ts, for the pay floor and
--   work_mode           workplace checks against the preferences below.
--
-- status gains 'expired' for the rows Dash takes off the list itself.
--
-- profiles: what the person wants from a job, as rules rather than prose.
--
--   home_location          where they live or want to work.
--   workplace_preferences  any of remote, hybrid, on_site; empty is any.
--   salary_floor_cents     the lowest base pay worth applying for, per year.
--   company_stages         any of early, growth, late, public; empty is any.
--
-- New columns on tables lib/jobs/sources.ts already lists, so the catalogue
-- does not change.

set search_path = job_search, extensions;

-- suggestions -----------------------------------------------------------------

alter table suggestions add column if not exists origin text not null default 'goal';
alter table suggestions add column if not exists dismiss_reason text;
alter table suggestions add column if not exists expired_reason text;
alter table suggestions add column if not exists posting_text text;
alter table suggestions add column if not exists posting_status text;
alter table suggestions add column if not exists posting_checked_at timestamptz;
alter table suggestions add column if not exists comp_min_cents bigint;
alter table suggestions add column if not exists comp_max_cents bigint;
alter table suggestions add column if not exists work_mode text;

-- Every row the suggestion run wrote so far has no found_in; every goals find
-- has one.
update suggestions
   set origin = 'search'
 where found_in is null and goal_item_id is null;

alter table suggestions drop constraint if exists suggestions_origin_ck;
alter table suggestions add constraint suggestions_origin_ck
  check (origin in ('search', 'board', 'goal'));

alter table suggestions drop constraint if exists suggestions_dismiss_reason_ck;
alter table suggestions add constraint suggestions_dismiss_reason_ck
  check (dismiss_reason is null or dismiss_reason in
    ('level', 'location', 'work', 'company', 'pay', 'closed', 'seen', 'other'));

alter table suggestions drop constraint if exists suggestions_expired_reason_ck;
alter table suggestions add constraint suggestions_expired_reason_ck
  check (expired_reason is null or expired_reason in ('closed', 'stale', 'duplicate'));

alter table suggestions drop constraint if exists suggestions_posting_text_length_ck;
alter table suggestions add constraint suggestions_posting_text_length_ck
  check (posting_text is null or length(posting_text) <= 20000);

alter table suggestions drop constraint if exists suggestions_posting_status_ck;
alter table suggestions add constraint suggestions_posting_status_ck
  check (posting_status is null or posting_status in ('open', 'closed', 'unreadable'));

alter table suggestions drop constraint if exists suggestions_work_mode_ck;
alter table suggestions add constraint suggestions_work_mode_ck
  check (work_mode is null or work_mode in ('onsite', 'hybrid', 'remote'));

alter table suggestions drop constraint if exists suggestions_status_ck;
alter table suggestions add constraint suggestions_status_ck
  check (status in ('open', 'done', 'dismissed', 'expired'));

-- profiles --------------------------------------------------------------------

alter table profiles add column if not exists home_location text;
alter table profiles add column if not exists workplace_preferences text[] not null default '{}';
alter table profiles add column if not exists salary_floor_cents bigint;
alter table profiles add column if not exists company_stages text[] not null default '{}';

alter table profiles drop constraint if exists profiles_home_location_length_ck;
alter table profiles add constraint profiles_home_location_length_ck
  check (home_location is null or length(home_location) <= 200);

alter table profiles drop constraint if exists profiles_workplace_preferences_ck;
alter table profiles add constraint profiles_workplace_preferences_ck
  check (workplace_preferences <@ array['remote', 'hybrid', 'on_site']::text[]);

alter table profiles drop constraint if exists profiles_salary_floor_ck;
alter table profiles add constraint profiles_salary_floor_ck
  check (salary_floor_cents is null or salary_floor_cents between 0 and 200000000);

alter table profiles drop constraint if exists profiles_company_stages_ck;
alter table profiles add constraint profiles_company_stages_ck
  check (company_stages <@ array['early', 'growth', 'late', 'public']::text[]);
