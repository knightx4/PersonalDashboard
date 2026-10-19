-- ===========================================================================
-- A goal step can ask for a phone message when Dash finishes it
-- (plan #2376.1, feature #2376).
--
-- Two columns on goals.items:
--
--   notify_on_done   true when the person wants a phone message as Dash
--                    closes the step as done. Off unless set.
--   notified_at      when that message was sent. Empty until one goes out,
--                    so a step is never announced twice.
--
-- No new table. Existing steps keep the switch off.
-- ===========================================================================

alter table goals.items
  add column if not exists notify_on_done boolean not null default false,
  add column if not exists notified_at timestamptz;

comment on column goals.items.notify_on_done is
  'The person wants a phone message when Dash closes this step as done.';
comment on column goals.items.notified_at is
  'When the done message was sent; null until one goes out.';
