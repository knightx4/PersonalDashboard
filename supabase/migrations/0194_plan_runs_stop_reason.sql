-- Why a session stopped, kept on its run (plan #1802).
--
-- A run that ends without closing its step has said nothing about why. The
-- app could only write the clock's note on it ("Nothing was heard from this
-- run for 2h"), so two stalled runs on a feature read the same whether the
-- feature was too big for one sitting or the session hit something nobody
-- could name. #1801 raises a stalled feature with the session's own reason,
-- and this is where that reason is kept.
--
-- `stop_reason` is one line in the session's words. It is separate from
-- `error`, which is the app's: a refused fire or the cutoff's note. A run the
-- app ends by timeout keeps that note in `error` and has no `stop_reason`, so
-- a reader can tell a reason a session gave from one the app inferred.
--
-- `stop_pieces` is the list a session that found the work too big would
-- split it into, in order. Two at least, since one piece is not a split, and
-- only alongside a reason. #1804 writes them as steps on a Yes.
--
-- `stopped_at` is when the session wrote the reason.

set search_path = public, extensions;

alter table plan_runs
  add column if not exists stop_reason text,
  add column if not exists stop_pieces text[],
  add column if not exists stopped_at timestamptz;

alter table plan_runs drop constraint if exists plan_runs_stop_reason_ck;
alter table plan_runs add constraint plan_runs_stop_reason_ck check (
  stop_reason is null
  or (length(btrim(stop_reason)) between 1 and 300 and position(E'\n' in stop_reason) = 0)
);

alter table plan_runs drop constraint if exists plan_runs_stop_pieces_ck;
alter table plan_runs add constraint plan_runs_stop_pieces_ck check (
  stop_pieces is null
  or (stop_reason is not null and cardinality(stop_pieces) between 2 and 20)
);

alter table plan_runs drop constraint if exists plan_runs_stopped_at_ck;
alter table plan_runs add constraint plan_runs_stopped_at_ck check (
  (stop_reason is null) = (stopped_at is null)
);
