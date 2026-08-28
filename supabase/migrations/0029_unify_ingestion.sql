-- One ingestion, shared by both workspaces.
--
-- Until now each workspace fetched the same mailbox for itself: its own Gmail
-- grant, its own copy of every message, its own LLM pass over it. That was the
-- price of the two apps having been separate. They are not any more.
--
-- Raw mail is domain-agnostic, so it moves to `core`:
--
--   core.email_accounts     one grant per user, not one per workspace
--   core.sync_jobs          one sync run
--   core.ingested_messages  the envelope, fetched exactly once
--
-- What stays per-domain is the *verdict*: what this workspace thinks a message
-- is, and what it linked it to. Those are genuinely different questions with
-- different answers -- the two message_classification enums do not even share
-- values -- so public.ingested_messages and job_search.ingested_messages remain,
-- reduced to exactly that, keyed by the core message id.
--
-- This migration only moves the commerce side, because it is the side that has
-- data. The job side's equivalents are empty and are dropped in the job_search
-- set, which runs after this one.

create schema if not exists core;

-- ---------------------------------------------------------------------------
-- Enums. These describe transport, not meaning, so unlike message_classification
-- they are genuinely shared and belong here rather than in either domain.
-- ---------------------------------------------------------------------------
create type core.email_provider as enum ('gmail', 'outlook');
create type core.email_account_status as enum ('active', 'needs_reauth', 'disconnected', 'error');
create type core.sync_job_type as enum ('backfill', 'incremental');
create type core.sync_job_status as enum ('queued', 'running', 'completed', 'failed');

-- ---------------------------------------------------------------------------
-- The mailbox grant.
-- ---------------------------------------------------------------------------
create table core.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider core.email_provider not null,
  email_address text not null,
  oauth_refresh_token text,
  oauth_access_token text,
  token_expires_at timestamptz,
  sync_cursor text,
  sync_page_token text,
  last_synced_at timestamptz,
  status core.email_account_status not null default 'active',
  -- 180 rather than the job side's 90: the wider of the two windows, since one
  -- fetch now has to satisfy both and the shorter one cannot be recovered later
  -- without a re-backfill.
  backfill_window_days int not null default 180,
  backfill_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_accounts_backfill_window_ck
    check (backfill_window_days >= 30 and backfill_window_days <= 730)
);

create index email_accounts_user_idx on core.email_accounts (user_id);
create unique index email_accounts_user_address_key
  on core.email_accounts (user_id, lower(email_address));

-- ---------------------------------------------------------------------------
-- A sync run.
-- ---------------------------------------------------------------------------
create table core.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references core.email_accounts(id) on delete cascade,
  type core.sync_job_type not null,
  status core.sync_job_status not null default 'queued',
  messages_seen int not null default 0,
  messages_classified int not null default 0,
  messages_parsed int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_jobs_account_idx on core.sync_jobs (email_account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The message envelope.
--
-- Headers only, never bodies -- the same promise the commerce table made, now
-- made once. reply_to_address comes from the job side, which needs it to tell a
-- recruiter replying from their own address apart from the ATS that sent the
-- original.
--
-- The unique key on (account, provider_message_id) is what makes "fetched
-- exactly once" true rather than aspirational.
-- ---------------------------------------------------------------------------
create table core.ingested_messages (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references core.email_accounts(id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  received_at timestamptz,
  from_address text,
  reply_to_address text,
  subject text,
  -- Set when the envelope has been scrubbed because no workspace claimed it.
  -- See core.scrub_unclaimed_messages() below.
  scrubbed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ingested_messages_provider_key
  on core.ingested_messages (email_account_id, provider_message_id);
create index ingested_messages_account_idx on core.ingested_messages (email_account_id);
create index ingested_messages_received_idx on core.ingested_messages (received_at desc);

-- ---------------------------------------------------------------------------
-- Move the commerce side's data across, ids preserved.
--
-- Preserving ids is what keeps returns.source_message_id valid, and what lets
-- public.ingested_messages become a verdict table keyed by the same id rather
-- than needing a new join column.
-- ---------------------------------------------------------------------------
insert into core.email_accounts (
  id, user_id, provider, email_address, oauth_refresh_token, oauth_access_token,
  token_expires_at, sync_cursor, sync_page_token, last_synced_at, status,
  backfill_window_days, backfill_completed_at, created_at, updated_at
)
select
  id, user_id, provider::text::core.email_provider, email_address,
  oauth_refresh_token, oauth_access_token, token_expires_at, sync_cursor,
  sync_page_token, last_synced_at, status::text::core.email_account_status,
  backfill_window_days, backfill_completed_at, created_at, updated_at
from public.email_accounts;

insert into core.sync_jobs (
  id, email_account_id, type, status, messages_seen, messages_classified,
  messages_parsed, started_at, finished_at, error, created_at, updated_at
)
select
  id, email_account_id, type::text::core.sync_job_type,
  status::text::core.sync_job_status, messages_seen, messages_classified,
  messages_parsed, started_at, finished_at, error, created_at, updated_at
from public.sync_jobs;

insert into core.ingested_messages (
  id, email_account_id, provider_message_id, thread_id, received_at,
  from_address, subject, created_at, updated_at
)
select
  id, email_account_id, provider_message_id, thread_id, received_at,
  from_address, subject, created_at, updated_at
from public.ingested_messages;

-- ---------------------------------------------------------------------------
-- Reduce public.ingested_messages to the commerce verdict.
--
-- The table keeps its name and its ids: returns.source_message_id still points
-- at it, and every existing row keeps meaning what it meant. What it loses is
-- the envelope, which now lives once in core.
-- ---------------------------------------------------------------------------
-- The commerce verdict policy reaches its owner through email_account_id and
-- public.email_accounts, both of which are about to disappear. Postgres tracks
-- that dependency and would refuse the column drop, so the policy goes first
-- and is rebuilt below on core.owns_message().
drop policy if exists ingested_messages_all on public.ingested_messages;

alter table public.ingested_messages
  drop constraint if exists ingested_not_relevant_is_bare_ck,
  drop constraint if exists ingested_messages_email_account_id_fkey;

drop index if exists public.ingested_messages_provider_key;
drop index if exists public.ingested_messages_account_idx;

alter table public.ingested_messages
  drop column email_account_id,
  drop column provider_message_id,
  drop column thread_id,
  drop column received_at,
  drop column from_address,
  drop column subject;

alter table public.ingested_messages
  add constraint ingested_messages_core_fk
    foreign key (id) references core.ingested_messages(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Who owns a message.
--
-- A verdict row no longer carries an account id, so a domain policy cannot
-- reach the owner by itself: it has to go through core, and core's own RLS
-- would apply to that lookup and hide the very row being checked. This is the
-- standard escape -- security definer, so the lookup bypasses RLS, with the
-- caller's identity checked explicitly inside rather than trusted.
--
-- `authenticated` must hold EXECUTE: a policy expression is evaluated with the
-- privileges of the role running the query, not those of the policy's owner, so
-- revoking it here would deny every read rather than secure one. That is safe,
-- because the only thing a direct caller can learn is whether they themselves
-- own a given message id -- which is exactly what their own policies already
-- tell them. `anon` gets nothing.
-- ---------------------------------------------------------------------------
create or replace function core.owns_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.ingested_messages m
    join core.email_accounts ea on ea.id = m.email_account_id
    where m.id = p_message_id
      and ea.user_id = (select auth.uid())
  );
$$;

revoke execute on function core.owns_message(uuid) from public, anon;
grant execute on function core.owns_message(uuid) to authenticated, service_role;

create policy ingested_messages_all on public.ingested_messages for all to authenticated
  using ((select core.owns_message(id)))
  with check ((select core.owns_message(id)));

-- public.email_accounts and public.sync_jobs are now duplicates of core's.
-- Their only dependants were the two tables just repointed above.
drop table public.sync_jobs;
drop table public.email_accounts;

-- ---------------------------------------------------------------------------
-- Scrubbing, which unification changes the meaning of.
--
-- The commerce table used to carry a check constraint saying a message
-- classified not_relevant must have a null subject, sender and thread: if we
-- are not keeping it, we do not keep anything about it. That was expressible as
-- a row constraint while one app owned both the envelope and the verdict.
--
-- It is not any more, and the rule itself has changed. "Not relevant" is now a
-- claim by one workspace, and a message the commerce side discards may be a
-- rejection letter the job side needs. The envelope may only be scrubbed when
-- every workspace has looked at it and none of them wants it -- which is a
-- statement about several tables, so it is a sweep rather than a constraint.
--
-- Called at the end of each sync. Idempotent, and it never un-scrubs.
-- ---------------------------------------------------------------------------
create or replace function core.scrub_unclaimed_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scrubbed integer;
begin
  with unclaimed as (
    select m.id
    from core.ingested_messages m
    where m.scrubbed_at is null
      -- every workspace has recorded a verdict ...
      and exists (select 1 from public.ingested_messages c where c.id = m.id)
      and exists (select 1 from job_search.ingested_messages j where j.id = m.id)
      -- ... and not one of them claimed it
      and not exists (
        select 1 from public.ingested_messages c
        where c.id = m.id
          and c.classification is distinct from 'not_relevant'::public.message_classification
      )
      and not exists (
        select 1 from job_search.ingested_messages j
        where j.id = m.id
          and j.classification is distinct from 'not_relevant'::job_search.message_classification
      )
  )
  update core.ingested_messages m
  set subject = null,
      from_address = null,
      reply_to_address = null,
      thread_id = null,
      scrubbed_at = now()
  from unclaimed u
  where m.id = u.id;

  get diagnostics scrubbed = row_count;
  return scrubbed;
end;
$$;

-- Only the sync calls this, and it runs as the service role.
revoke execute on function core.scrub_unclaimed_messages() from public, anon, authenticated;
grant execute on function core.scrub_unclaimed_messages() to service_role;

-- ---------------------------------------------------------------------------
-- RLS. Everything in core hangs off an email account, which hangs off a user.
-- ---------------------------------------------------------------------------
alter table core.email_accounts enable row level security;
alter table core.sync_jobs enable row level security;
alter table core.ingested_messages enable row level security;

create policy email_accounts_select on core.email_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy email_accounts_insert on core.email_accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy email_accounts_update on core.email_accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy email_accounts_delete on core.email_accounts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy sync_jobs_all on core.sync_jobs for all to authenticated
  using (exists (
    select 1 from core.email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from core.email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ));

create policy ingested_messages_all on core.ingested_messages for all to authenticated
  using (exists (
    select 1 from core.email_accounts ea
    where ea.id = ingested_messages.email_account_id and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from core.email_accounts ea
    where ea.id = ingested_messages.email_account_id and ea.user_id = (select auth.uid())
  ));

grant usage on schema core to authenticated, service_role;
grant select, insert, update, delete on all tables in schema core to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The commerce read surface.
--
-- Splitting the envelope from the verdict costs the app a join it used to get
-- for free, and PostgREST cannot embed across schemas -- the review queue's
-- `email_accounts!inner ( user_id )` has nowhere to resolve to any more. A view
-- in this schema puts the whole row back together, user_id included, so reads
-- stay one request.
--
-- security_invoker: the view runs with the caller's privileges, so the RLS on
-- core and on the verdict table both still apply. Without it the view would run
-- as its owner and quietly become a hole straight through both.
--
-- Reads only. Writes go to the table that owns the column, which is what keeps
-- it obvious where a value actually lives.
-- ---------------------------------------------------------------------------
create view public.inbox_messages with (security_invoker = true) as
select
  m.id,
  m.email_account_id,
  ea.user_id,
  m.provider_message_id,
  m.thread_id,
  m.received_at,
  m.from_address,
  m.reply_to_address,
  m.subject,
  m.scrubbed_at,
  v.classification,
  v.parse_status,
  v.parse_confidence,
  v.parser_version,
  v.resulting_order_id,
  v.error
from core.ingested_messages m
join core.email_accounts ea on ea.id = m.email_account_id
join public.ingested_messages v on v.id = m.id;

grant select on public.inbox_messages to authenticated, service_role;
