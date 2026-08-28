-- Bound how often a held message is looked at again.
--
-- Held mail is now re-offered to the linker on every sync, because "on file"
-- keeps changing and a message held on Monday is frequently linkable by Friday.
-- Left unbounded that is expensive in the wrong direction: each retry costs a
-- Gmail body fetch and usually a model call, so a message that will never
-- resolve would be re-read, and re-paid for, every day forever.
--
-- So each look increments this, and the reprocess pass ignores rows that have
-- had a few. The counter resets to zero whenever the sync creates a company or
-- an application, because that is precisely when the world changed underneath
-- the held message and it is worth another look.

set search_path = job_search, extensions;

alter table ingested_messages
  add column if not exists relink_attempts int not null default 0;

comment on column ingested_messages.relink_attempts is
  'How many times the reprocess pass has re-run the linker on this held message. Reset to 0 when a sync creates a company or application, since that is what makes a retry worth paying for.';

-- The reprocess pass reads exactly this shape.
create index if not exists ingested_messages_held_idx
  on ingested_messages (parse_status, relink_attempts)
  where parse_status = 'needs_review';

-- The view is what the app reads; without the column here the reprocess pass
-- cannot filter on it in one query.
create or replace view job_search.inbox_messages with (security_invoker = true) as
select
  m.id,
  m.email_account_id,
  ea.user_id,
  ea.email_address,
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
  v.error,
  -- Appended rather than slotted in beside the other verdict columns:
  -- `create or replace view` can only add columns at the end.
  v.relink_attempts
from core.ingested_messages m
join core.email_accounts ea on ea.id = m.email_account_id
join job_search.ingested_messages v on v.id = m.id;

grant select on job_search.inbox_messages to authenticated, service_role;

-- Incrementing in place needs SQL: PostgREST can set a column to a value but
-- not to "itself plus one", and reading each row to write it back would be one
-- round trip per message for no benefit.
create or replace function job_search.bump_relink_attempts(message_ids uuid[])
returns void
language sql
security invoker
set search_path = job_search, pg_temp
as $$
  update job_search.ingested_messages
     set relink_attempts = relink_attempts + 1,
         updated_at = now()
   where id = any(message_ids);
$$;

revoke all on function job_search.bump_relink_attempts(uuid[]) from public;
grant execute on function job_search.bump_relink_attempts(uuid[]) to authenticated, service_role;
