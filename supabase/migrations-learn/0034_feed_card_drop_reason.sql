-- Why a Learn now pick was dropped (plan #807).
--
-- The card writer reads each picked section and drops it when the section does
-- not serve the target it was picked for, or when the model's report cannot be
-- used. A dropped row is kept so the section is never picked again, and this
-- column keeps the writer's one sentence on why. Without it, a run of drops
-- looks the same whether the naming call is guessing badly or the writer is
-- too strict, and those need different fixes.
--
-- Null on every row that was not dropped by the writer.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists drop_reason text;
