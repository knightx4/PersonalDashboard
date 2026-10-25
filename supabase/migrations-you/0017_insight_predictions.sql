-- Insights: a "knew it" mark, and predictions that stay hidden until checked.
--
-- Knew it is a fourth verdict beside right, not quite and wrong: the card was
-- true, and the person already knew it. The next run reads it as a card that
-- told them nothing, so it aims past that kind of claim.
--
-- A prediction is an insight of kind 'prediction' written with status
-- 'pending', which the tab never lists, and check_on, the day from which the
-- records can show whether it happened. A later run (monthly or Look again)
-- checks each one that is due, writes the outcome, outcome_note and
-- checked_at, and sets it 'shown'; only then does the person see it, with the
-- result. A shown prediction always has its outcome, and a pending one never
-- does.
--
-- Schema change only; no existing row is rewritten.

alter table you.insight_verdicts drop constraint if exists insight_verdicts_verdict_check;
alter table you.insight_verdicts
  add constraint insight_verdicts_verdict_check
  check (verdict in ('right', 'not_quite', 'wrong', 'knew_it'));

alter table you.insights drop constraint if exists insights_status_ck;
alter table you.insights
  add constraint insights_status_ck
  check (status in ('shown', 'retired', 'superseded', 'pending'));

alter table you.insights
  add column if not exists check_on date,
  add column if not exists outcome text,
  add column if not exists outcome_note text,
  add column if not exists checked_at timestamptz;

alter table you.insights drop constraint if exists insights_outcome_ck;
alter table you.insights
  add constraint insights_outcome_ck
  check (outcome is null or outcome in ('happened', 'did_not', 'unclear'));

alter table you.insights drop constraint if exists insights_outcome_note_ck;
alter table you.insights
  add constraint insights_outcome_note_ck
  check (outcome_note is null or char_length(outcome_note) <= 2000);

-- A pending row is a prediction waiting for its day; a prediction is shown
-- only once it has been checked.
alter table you.insights drop constraint if exists insights_prediction_ck;
alter table you.insights
  add constraint insights_prediction_ck
  check (
    (status <> 'pending' or (kind = 'prediction' and check_on is not null and outcome is null))
    and (kind <> 'prediction' or status <> 'shown' or (outcome is not null and checked_at is not null))
  );

comment on column you.insights.check_on is
  'For a prediction: the first day the records can show whether it happened. The run on or after it checks it.';
comment on column you.insights.outcome is
  'For a checked prediction: happened, did_not or unclear.';
comment on column you.insights.outcome_note is
  'For a checked prediction: what the records showed, in a sentence or two.';
comment on column you.insights.checked_at is
  'For a prediction: when a run checked it and showed it.';
