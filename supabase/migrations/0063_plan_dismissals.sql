-- "Not right now", said about a question or about a patch of fog.
--
-- 0062 gave an idea the same move, and this is the rest of it. The plan asks
-- the same things forever: a decision nobody wants to settle sits on the page
-- unanswered, and a fog patch is repeated to every re-shape of the feature it
-- sits on. Answering is not the way out of either -- an invented answer is read
-- by every session afterwards as though somebody meant it -- and dropping a
-- question says it was withdrawn, which is a claim about the question rather
-- than about your afternoon.
--
-- So: dismissal, and #340 settled which kind. Not gone. The row leaves the
-- page, the counts, the CLI listings and every brief, the Dismissed view lists
-- what was put aside, and one press brings it back. Nothing surfaces on its
-- own and nothing is deleted.
--
-- A timestamp rather than a flag, the same as ideas: "when did I decide not to
-- think about this" is the question you have a week later, and null already
-- means live.
--
--   dismissed_at      the row itself: a question you are not answering now.
--   fog_dismissed_at  the patch of fog on the row. Its own column, because a
--                     feature whose fog you have put aside is otherwise a live
--                     feature with live steps -- dismissing the row would take
--                     the work with it. Cleared whenever the patch is
--                     rewritten: a new admission is not one anybody has put
--                     aside.
--
-- Not a status, for the reason `kind` is not one either: nothing about the row
-- has been settled. A dismissed question is still unanswered and a dismissed
-- step is still unbuilt. What it says is that you do not want to be asked
-- again, which is orthogonal to where the work stands.
--
-- Partial indexes, because every read but one asks for the rows that are not
-- dismissed, and the Dismissed view is the small side.

set search_path = public, extensions;

alter table plan_items
  add column if not exists dismissed_at timestamptz,
  add column if not exists fog_dismissed_at timestamptz;

create index if not exists plan_items_dismissed_idx
  on plan_items (user_id, dismissed_at desc)
  where dismissed_at is not null;

create index if not exists plan_items_fog_dismissed_idx
  on plan_items (user_id, fog_dismissed_at desc)
  where fog_dismissed_at is not null;

comment on column plan_items.dismissed_at is
  'When the row was put aside as not right now. Null while it is live; hidden from the page, the counts and every brief while set.';

comment on column plan_items.fog_dismissed_at is
  'The same for the fog patch alone. Cleared when the patch is rewritten.';
