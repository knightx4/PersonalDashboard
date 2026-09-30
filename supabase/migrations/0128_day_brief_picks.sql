-- The morning brief's picks (plan #1239).
--
-- The brief now names one to three things that matter today, each with the
-- reason it matters and a link (lib/day-brief/picks.ts). Rules shortlist the
-- day's candidates and Dash picks from the shortlist; the picks are stored on
-- the day's row so the notification (#1240), the home page (#1241) and the
-- record of what was opened (#1242) all read the same choice.
--
-- Columns
--
--   picks  [{key, kind, title, reason, href}], at most three, in the order
--          the brief names them. An empty list is a day where nothing
--          qualified. Null is a row written before this migration, which the
--          home page shows by its body as before.

set search_path = core, public, extensions;

alter table core.day_briefs add column if not exists picks jsonb;

alter table core.day_briefs drop constraint if exists day_briefs_picks_ck;
alter table core.day_briefs add constraint day_briefs_picks_ck
  check (picks is null or (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) <= 3));

comment on column core.day_briefs.picks is
  'What the brief names: at most three {key, kind, title, reason, href}; [] when nothing qualified, null before plan #1239.';
