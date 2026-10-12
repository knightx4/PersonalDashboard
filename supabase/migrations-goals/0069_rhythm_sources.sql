-- ===========================================================================
-- Rhythms that count themselves.
--
-- A rhythm's count has been kept by hand: Count one on the step, a tick on
-- Todo, or a sentence in the capture box. Of the person's first ten closed
-- periods nine were missed, mostly because nothing was logged, while the work
-- itself was already on record elsewhere in the app. These two columns let a
-- rhythm step name where its count is read from instead:
--
--   items.count_source   'applications': job applications sent in the
--                        period (job_search.applications.submitted_at).
--                        'calendar': events on the person's own calendar in
--                        the period, typed in Todo (todo.events) or read from
--                        a subscribed feed (todo.feed_events), whose title
--                        matches count_match. Null: counted by hand, as
--                        before.
--   items.count_match    for 'calendar' only, the text an event's title has
--                        to contain, ignoring case. Several alternatives are
--                        separated by '|': "urbanism|community board" counts
--                        an event whose title contains either.
--
-- The sync in lib/goals/rhythms-store.ts writes the source's count onto each
-- open period and closes ended periods on it, so the hand counts are not used
-- for such a rhythm. Both columns are on steps of kind 'rhythm' only.
--
-- Dash may set both when it maps or edits a rhythm: items_claude_guard (0051)
-- restricts status, approval, answers and dropping, not these columns, so no
-- guard changes here. History, row level security and grants are the
-- table's own and cover the new columns.
-- ===========================================================================

alter table goals.items
  add column count_source text,
  add column count_match text;

alter table goals.items
  add constraint items_count_source_ck check (
    count_source is null
    or (kind = 'rhythm' and count_source in ('applications', 'calendar'))
  );

alter table goals.items
  add constraint items_count_match_ck check (
    (count_source is not distinct from 'calendar') = (count_match is not null)
    and (count_match is null or (btrim(count_match) <> '' and length(count_match) <= 200))
  );

comment on column goals.items.count_source is
  'On a rhythm step, where its count is read from instead of being kept by hand: applications (job applications sent) or calendar (events whose title matches count_match). Null when counted by hand.';
comment on column goals.items.count_match is
  'With count_source calendar, the text an event title must contain, ignoring case; alternatives separated by |, such as "urbanism|community board".';

notify pgrst, 'reload schema';
