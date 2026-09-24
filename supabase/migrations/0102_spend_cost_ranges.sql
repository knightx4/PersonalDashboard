-- What each paid operation has cost over the last thirty days, as a range.
--
-- The $ hint beside a paid button (plan #913) says about how much a press
-- will cost. lib/core/spend/estimate.ts asks this function for the range of
-- recent runs and falls back to a written guess where there are too few. The
-- arithmetic lives here rather than in TypeScript for one reason: the ledger
-- holds thousands of rows a month, mostly from background sweeps, and reading
-- them all through PostgREST would be cut off at its row cap without saying
-- so. This returns one row per operation.
--
-- **A ledger row is one API call, and a press can make several.** Importing a
-- reading list records its planning calls as separate rows written a moment
-- apart. So for an operation estimated per run, rows of the same operation
-- written within `p_gap_seconds` of the one before are added up as one run.
-- Every writer records its rows together after the work is done, so a gap of
-- ten seconds separates presses without splitting one.
--
-- **Per-unit operations are counted a row at a time.** Pricing an item for
-- resale, reading one order email, resolving one reference: each is one call,
-- the button multiplies by the count it knows, and several of them fired in
-- parallel would be merged into one run by the gap rule. The caller names
-- them in `p_unit_operations`.
--
-- Low, median and high are the 10th, 50th and 90th percentiles. Rows with no
-- cost (a model missing from the price table) are left out, since a range
-- that counted them as free would read low.
--
-- Security invoker, so RLS decides whose rows are read; the user id is still
-- a parameter because the service role has no RLS and a background caller
-- must not average everybody's calls together.

create or replace function core.spend_cost_ranges(
  p_user_id uuid,
  p_operations text[],
  p_unit_operations text[] default '{}',
  p_days integer default 30,
  p_gap_seconds integer default 10
)
returns table (
  operation text,
  runs integer,
  low_micros bigint,
  median_micros bigint,
  high_micros bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select
      s.operation,
      s.cost_micros,
      s.created_at,
      s.operation = any (p_unit_operations) as per_unit,
      lag(s.created_at) over (partition by s.operation order by s.created_at) as previous_at
    from core.model_spend s
    where s.user_id = p_user_id
      and s.operation = any (p_operations)
      and s.cost_micros is not null
      and s.created_at >= now() - make_interval(days => p_days)
  ),
  marked as (
    select
      r.*,
      sum(
        case
          when r.per_unit or r.previous_at is null
            or r.created_at - r.previous_at > make_interval(secs => p_gap_seconds)
          then 1 else 0
        end
      ) over (partition by r.operation order by r.created_at rows unbounded preceding) as run_no
    from recent r
  ),
  runs as (
    select m.operation, m.run_no, sum(m.cost_micros) as cost
    from marked m
    group by m.operation, m.run_no
  )
  select
    r.operation,
    count(*)::integer as runs,
    round(percentile_cont(0.1) within group (order by r.cost))::bigint as low_micros,
    round(percentile_cont(0.5) within group (order by r.cost))::bigint as median_micros,
    round(percentile_cont(0.9) within group (order by r.cost))::bigint as high_micros
  from runs r
  group by r.operation;
$$;

revoke execute on function core.spend_cost_ranges(uuid, text[], text[], integer, integer)
  from public, anon;
grant execute on function core.spend_cost_ranges(uuid, text[], text[], integer, integer)
  to authenticated, service_role;
