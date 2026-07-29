-- Transient pagination for in-flight sync jobs (Gmail messages.list /
-- history.list page tokens). Durable mailbox cursor stays on sync_cursor
-- (Gmail historyId or Graph delta token).

alter table email_accounts
  add column sync_page_token text;

comment on column email_accounts.sync_cursor is
  'Durable mailbox cursor: Gmail historyId or Graph delta token.';
comment on column email_accounts.sync_page_token is
  'Transient pagination token for an in-flight backfill or incremental sync.';
