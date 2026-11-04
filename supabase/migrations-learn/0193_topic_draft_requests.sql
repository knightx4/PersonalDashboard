-- Topic drafts go to the routine, not the API.
--
--   learn.topic_draft_requests
--       One row per topic someone asked Dash to draft. Drafting a topic was
--       a pair of Sonnet calls of about 50,000 input tokens each, and a
--       subject's preparation drafts forty of them: $124 of Learn's $150 in
--       the month to 28 October 2026, $87 of it on two mornings when the
--       daily cron prepared seven subjects. Now every press that drafts a
--       topic writes a row here and fires the goals routine, whose session
--       follows .claude/skills/learn-drafts/SKILL.md: it reads the prompt the
--       API call would have been sent, writes the draft itself, and saves it
--       through scripts/learn-drafts.ts, which checks and keeps it as the
--       API path did (lib/learn/levels/draft-request.ts).
--
--       `input` is what the call is given besides the map: the scope, the
--       sources, the stored documents and canon, the brief. `after_draft` is what
--       the press did with the draft once it was kept (approve it, put it on
--       a lens, settle the topic that wanted it), done by the script once the
--       draft is saved. `preparation_id` is set when a subject's
--       preparation asked, so its draft_topics step can tell its own
--       requests apart.
--
--       status: queued, drafting (a session has taken it), done (topic_id
--       is the kept topic) or failed (error says why). One open request per
--       ask: asking again while one waits finds the one waiting.
--
-- Bookkeeping, not a source: the drafted topic is in learn.topics.

set search_path = learn, public, extensions;

create table if not exists learn.topic_draft_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null,
  input jsonb not null default '{}'::jsonb,
  after_draft jsonb not null default '{}'::jsonb,
  preparation_id uuid references learn.subject_preparations (id) on delete set null,
  status text not null default 'queued',
  topic_id uuid references learn.topics (id) on delete set null,
  error text,
  run_url text,
  requested_at timestamptz not null default now(),
  taken_at timestamptz,
  finished_at timestamptz,
  constraint topic_draft_requests_goal_ck check (length(btrim(goal)) between 1 and 1000),
  constraint topic_draft_requests_status_ck check (status in ('queued', 'drafting', 'done', 'failed'))
);

create unique index if not exists topic_draft_requests_open_uq
  on learn.topic_draft_requests (user_id, lower(btrim(goal)))
  where status in ('queued', 'drafting');

create index if not exists topic_draft_requests_user_status_idx
  on learn.topic_draft_requests (user_id, status, requested_at);

create index if not exists topic_draft_requests_preparation_idx
  on learn.topic_draft_requests (preparation_id)
  where preparation_id is not null;

alter table learn.topic_draft_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'topic_draft_requests' and policyname = 'topic_draft_requests_own'
  ) then
    create policy topic_draft_requests_own on learn.topic_draft_requests for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

-- A press inserts and reads its own; the routine's script writes with the service role.
revoke all on learn.topic_draft_requests from anon, authenticated;
grant select, insert, update on learn.topic_draft_requests to authenticated;
grant select, insert, update, delete on learn.topic_draft_requests to service_role;

comment on table learn.topic_draft_requests is
  'Bookkeeping: a topic someone asked Dash to draft, waiting for the routine (.claude/skills/learn-drafts) to draft it without API spend.';
comment on column learn.topic_draft_requests.input is
  'What the drafting prompt is given besides the map: scope, sources, documents, canon, brief (lib/learn/levels/draft-request.ts).';
comment on column learn.topic_draft_requests.after_draft is
  'What happens to the draft once it is kept: approve, lens target, subject lens, refined frame, wanted topic settled.';
