-- Prepared research on a company: what several hours of reading its own
-- materials, filings, news and talks turns up, written by the company
-- research routine (.claude/skills/company-research) when the person presses
-- Research on the company's Perspective tab. One row per run; the newest
-- ready one is what the tab shows, and a later run is a refresh of it.
--
--   status    queued (pressed, routine not started), researching, ready, failed
--   summary   the short read at the top, markdown
--   sections  [ { key, title, body } ]; body is markdown, with an inline link
--             on every claim to the page it came from
--   sources   [ { url, title, kind, publisher, published_on, note } ]; every
--             page read, so the person can go to the raw material. kind is one
--             of company, filing, news, talk, posting, analysis, mail, other
--   drafts    { "<perspective key>": "suggested answer" } for the Perspective
--             questions, offered beside each one with a button to use it
--   run_url   the Claude Code session that did the reading

set search_path = job_search, extensions;

create table if not exists company_research (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  status text not null default 'queued',
  summary text,
  sections jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  drafts jsonb not null default '{}'::jsonb,
  error text,
  run_url text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_research_status_ck check (status in ('queued', 'researching', 'ready', 'failed')),
  constraint company_research_sections_ck check (jsonb_typeof(sections) = 'array'),
  constraint company_research_sources_ck check (jsonb_typeof(sources) = 'array'),
  constraint company_research_drafts_ck check (jsonb_typeof(drafts) = 'object')
);

create index if not exists company_research_company_idx on company_research (company_id, requested_at desc);
create index if not exists company_research_user_idx on company_research (user_id);

-- One run at a time per company, so a second press does not start a second
-- session reading the same pages.
create unique index if not exists company_research_one_running
  on company_research (company_id) where status in ('queued', 'researching');

create trigger company_research_touch_updated_at before update on company_research
  for each row execute function job_search.touch_updated_at();

create trigger company_research_same_owner before insert or update on company_research
  for each row execute function job_search.assert_parents_same_owner();

alter table company_research enable row level security;

create policy company_research_select on company_research for select to authenticated
  using (user_id = (select auth.uid()));
create policy company_research_insert on company_research for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy company_research_update on company_research for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy company_research_delete on company_research for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on company_research to authenticated;
grant all on company_research to service_role;
revoke all on company_research from anon;

notify pgrst, 'reload schema';
