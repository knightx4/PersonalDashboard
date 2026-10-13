-- The review queue reads held messages through job_search.inbox_messages, so
-- the role title 0044 keeps goes on the end of the view (note b48d2b61).
-- Replacing a view may only add columns at the end; every column before it is
-- as it was.

create or replace view job_search.inbox_messages
with (security_invoker = true) as
select m.id,
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
    v.relink_attempts,
    v.role_hint
from core.ingested_messages m
  join core.email_accounts ea on ea.id = m.email_account_id
  join job_search.ingested_messages v on v.id = m.id;
