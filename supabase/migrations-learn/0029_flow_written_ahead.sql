-- Questions Practice Flow writes before they are needed (plan #771).
--
-- The flow keeps about three questions written ahead, so pressing Next shows
-- one straight away instead of waiting on a model call. They are ordinary
-- `probes` rows, unanswered, with three columns saying where they are in that
-- queue. A row with all three null is a question asked the old way, and
-- nothing about it changes.
--
-- `picked_state` is the claim's state when the question was picked for it,
-- and is what marks a row as one the flow wrote. The pick only holds while the
-- claim is still in that state: a question written about a claim you were
-- unsure of is the wrong question once an answer has settled it. So the flow
-- compares this with the claim's state now, before showing it.
--
-- `picked_recheck` says the pick was a re-check, and which way the claim had
-- been settled (`tested` or `declared`), because the screen says so above the
-- question. Null for an ordinary question.
--
-- `shown_at` is when the flow put it on the screen. Until then the question
-- is in the queue and is left out of everything that lists what has been
-- asked, since it has not been.
--
-- `discarded_at` is when the flow threw it away unshown because the claim's
-- state had moved. Kept rather than deleted, so the questions paid for and
-- never shown can be counted against the `write-probe-ahead` spend.

alter table learn.probes
  add column picked_state text,
  add column picked_recheck text
    check (picked_recheck is null or picked_recheck in ('tested', 'declared')),
  add column shown_at timestamptz,
  add column discarded_at timestamptz;

-- The queue: the flow's own rows, not yet answered or thrown away, oldest
-- first. Small, and read on every Next.
create index probes_flow_queue_idx
  on learn.probes (user_id, created_at)
  where picked_state is not null and answered_at is null and discarded_at is null;
