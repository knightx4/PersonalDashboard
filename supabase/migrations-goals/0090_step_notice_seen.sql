-- ===========================================================================
-- Remember which finished-step notices the person has seen
-- (plan #2611.1, feature #2611).
--
-- One column on goals.items:
--
--   notice_seen_at   when the person opened or dismissed the notice of a
--                    step that closed with notify_on_done on. Empty until
--                    then, so the step shows as new in the Goals Inbox.
--
-- No new table. Existing rows keep it empty and no row is changed.
-- ===========================================================================

alter table goals.items
  add column if not exists notice_seen_at timestamptz;

comment on column goals.items.notice_seen_at is
  'When the person saw the done notice of this step; null until they open or dismiss it.';
