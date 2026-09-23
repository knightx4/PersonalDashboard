-- What the overnight runner last decided, and when.
--
-- Every tick works out why it did or did not fire -- the last session is still
-- going, nothing is ready and why, a feature was started -- and until now it
-- only logged that sentence. The page could not see it, so a night waiting on
-- three re-shapes looked the same as a night that had stopped working, and
-- Dash guessed "the session may have stalled" from pushes that belonged to
-- other sessions.
--
-- `last_tick_at` is when the tick last ran for this account, which also says
-- whether the clock is ticking at all. `last_tick_note` is the sentence, shown
-- verbatim. Both are written by `inngest/dev/overnight.ts` on every tick of a
-- running night, with the service role; the grants in 0077 cover the new
-- columns unchanged.

set search_path = public, extensions;

alter table plan_overnight_runs add column if not exists last_tick_at timestamptz;
alter table plan_overnight_runs add column if not exists last_tick_note text;

alter table plan_overnight_runs drop constraint if exists plan_overnight_runs_last_tick_note_length_ck;
alter table plan_overnight_runs add constraint plan_overnight_runs_last_tick_note_length_ck
  check (last_tick_note is null or length(last_tick_note) <= 2000);
