-- Re-check the inspiration takeaways marked covered under the first check
-- (plan #1608).
--
-- The first real merge run, on 3 October 2026, marked 36 of 61 takeaways
-- covered, most of them by features that only touch the same area. The check
-- now has to quote the sentence of the feature or idea that does what the
-- takeaway asks, and gives up a cover it cannot quote (lib/dev/inspiration/
-- merge.ts, on main as 940d1aba at 16:42 UTC that day).
--
-- This puts every takeaway covered before then back to open, with no covering
-- row and no stored vector. A takeaway that is open with no vector is what the
-- merge reads as not yet judged, so the next daily run, or a press of Check
-- now, judges each one again under the stricter check. Nothing else changes:
-- titles, wording, video links and scores stay as they are, and takeaways that
-- were open, crafted or dismissed are not touched.

update public.inspiration_takeaways
set status = 'open',
    idea_id = null,
    plan_item_id = null,
    embedding = null,
    embedding_model = null
where status = 'covered'
  and updated_at < timestamptz '2026-10-03 16:42:52+00';
