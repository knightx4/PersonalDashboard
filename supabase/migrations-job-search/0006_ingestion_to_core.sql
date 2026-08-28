-- Hand ingestion over to core.
--
-- This schema's email_accounts, sync_jobs and ingested_messages were built when
-- the job tracker was a separate deployment that had to fetch its own mail. It
-- is not, and it never did: these three tables have never held a row. The
-- commerce side's equivalents hold the real data, so the migration is
-- one-directional -- core takes over, and these are simply dropped.
--
-- What remains is this workspace's *verdict* on a message: what it thinks the
-- message is, and what it linked it to. That genuinely belongs here.
-- job_search.message_classification has eleven values about recruiting and
-- public.message_classification has six about commerce; they are different
-- questions about the same email, and both answers are worth keeping.

set search_path = job_search, extensions;

-- application_events points at the old table. It is empty, like everything
-- else here, but the constraint has to go before the table can.
alter table job_search.application_events
  drop constraint if exists application_events_message_fk;

drop table if exists job_search.ingested_messages;
drop table if exists job_search.sync_jobs;
drop table if exists job_search.email_accounts;

-- ---------------------------------------------------------------------------
-- The recruiting verdict, keyed by the core message id.
--
-- No email_account_id and no envelope: both live in core now, and a second copy
-- of a subject line is a second place for it to outlive its retention rule.
-- ---------------------------------------------------------------------------
create table job_search.ingested_messages (
  id uuid primary key references core.ingested_messages(id) on delete cascade,
  classification job_search.message_classification,
  parse_status job_search.parse_status not null default 'pending',
  parse_confidence numeric,
  parser_version text,
  resulting_application_id uuid references job_search.applications(id) on delete set null,
  link_confidence numeric,
  link_method text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingested_confidence_ck
    check (parse_confidence is null or (parse_confidence >= 0 and parse_confidence <= 1)),
  constraint ingested_link_confidence_ck
    check (link_confidence is null or (link_confidence >= 0 and link_confidence <= 1))
);

create index ingested_messages_application_idx
  on job_search.ingested_messages (resulting_application_id);
create index ingested_messages_pending_idx
  on job_search.ingested_messages (parse_status)
  where parse_status = 'pending';

alter table job_search.application_events
  add constraint application_events_message_fk
    foreign key (ingested_message_id)
    references job_search.ingested_messages(id) on delete set null;

create trigger ingested_messages_touch
  before update on job_search.ingested_messages
  for each row execute function job_search.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Ownership is a fact about the core message, so it is asked there --
-- see the comment on core.owns_message().
-- ---------------------------------------------------------------------------
alter table job_search.ingested_messages enable row level security;

create policy ingested_messages_all on job_search.ingested_messages for all to authenticated
  using ((select core.owns_message(id)))
  with check ((select core.owns_message(id)));

-- ---------------------------------------------------------------------------
-- The recruiting read surface, mirroring public.inbox_messages.
--
-- PostgREST cannot embed across schemas, so the review queue would otherwise
-- need one request for the verdict and another for the subject line it is
-- showing. security_invoker keeps the caller's RLS in force on both sides of
-- the join.
-- ---------------------------------------------------------------------------
create view job_search.inbox_messages with (security_invoker = true) as
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
  v.resulting_application_id,
  v.link_confidence,
  v.link_method,
  v.error
from core.ingested_messages m
join core.email_accounts ea on ea.id = m.email_account_id
join job_search.ingested_messages v on v.id = m.id;

grant select on job_search.inbox_messages to authenticated, service_role;
