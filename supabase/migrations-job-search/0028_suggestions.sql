-- Suggestions: what Dash thinks you should do next in the search.
--
-- Two kinds, written by the suggestion run (lib/jobs/suggest/run.ts) on a
-- clock and from the buttons on This week:
--
--   reach_out  a person to contact, why now, what to do, and the message to
--              send. contact_id is set when the person is already a contact;
--              a suggestion to find someone at a company you have applied to
--              has only company_id and a named title to look for.
--   apply      an open posting Dash found with a web search, with the link,
--              why it fits and how to go about it. role_id is set once it is
--              saved to the pipeline.
--
-- status is open until the person acts on it (done) or turns it down
-- (dismissed). Rows are kept after either, so a dismissed posting or person is
-- not suggested again and the run can see what was said recently.

set search_path = job_search, extensions;

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  status text not null default 'open',
  contact_id uuid references contacts (id) on delete cascade,
  company_id uuid references companies (id) on delete set null,
  -- the company as the run named it, for a posting at a company not on file
  company_name text,
  -- "Jordan Lee, recruiter at Acme" or "Senior Data Analyst"
  headline text not null,
  why text not null,
  -- what to do, in a few plain steps
  move text not null,
  channel touch_channel,
  -- the message to send, for reach_out
  message text,
  -- the posting, for apply
  url text,
  location text,
  role_id uuid references roles (id) on delete set null,
  model text,
  created_at timestamptz not null default now(),
  acted_at timestamptz,
  constraint suggestions_kind_ck check (kind in ('reach_out', 'apply')),
  constraint suggestions_status_ck check (status in ('open', 'done', 'dismissed')),
  constraint suggestions_apply_url_ck check (kind <> 'apply' or url is not null),
  constraint suggestions_headline_length_ck check (length(headline) <= 300),
  constraint suggestions_message_length_ck check (message is null or length(message) <= 4000)
);

create index if not exists suggestions_user_open_idx
  on suggestions (user_id, kind, created_at desc) where status = 'open';

-- One open suggestion per contact: a second would say the same thing twice.
create unique index if not exists suggestions_user_contact_open_key
  on suggestions (user_id, contact_id) where status = 'open' and contact_id is not null;

-- A posting is suggested once, whatever became of it.
create unique index if not exists suggestions_user_url_key
  on suggestions (user_id, url) where url is not null;

alter table suggestions enable row level security;

drop policy if exists suggestions_select on suggestions;
create policy suggestions_select on suggestions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists suggestions_insert on suggestions;
create policy suggestions_insert on suggestions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists suggestions_update on suggestions;
create policy suggestions_update on suggestions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists suggestions_delete on suggestions;
create policy suggestions_delete on suggestions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on suggestions to authenticated;
grant all on suggestions to service_role;
revoke all on suggestions from anon;
