-- Dash can propose starting a watch from Ask Dash (plan #1296).
--
-- A fourth kind of change in core.dash_changes (0125): 'start_watch', whose
-- input is the core.watches row Dash proposes (title, url, condition,
-- report_times, ends_at, goal_item_id). Confirming it inserts that watch as the
-- person (lib/ask/changes.ts); undoing it deletes the watch while it is still
-- running and has sent nothing. written_table is then core.watches.

set search_path = core, public, extensions;

alter table core.dash_changes drop constraint if exists dash_changes_kind_ck;
alter table core.dash_changes add constraint dash_changes_kind_ck
  check (kind in ('add_todo', 'add_goal_step', 'mark_returned', 'start_watch'));
