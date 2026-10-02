-- Model spend per workspace over the last 7 and 30 days, for the Usage tab in
-- Dev (plan #1482). core.model_spend records the workspace a call was made
-- for (`module`) and what it was doing, never the page it was made from, so
-- spend can be set beside a workspace's opens and not beside a single page's.
--
-- A view rather than a read of the ledger in the page: a month holds more
-- rows than one PostgREST request returns, and a sum cut short by the row cap
-- would be a wrong number shown as a right one. security_invoker, so the
-- ledger's own RLS keeps each person to their rows.

create view core.workspace_spend with (security_invoker = true) as
select user_id, module,
       coalesce(sum(cost_micros) filter (where created_at >= now() - interval '7 days'), 0)::bigint as spend_7,
       coalesce(sum(cost_micros), 0)::bigint as spend_30,
       count(*)::integer as calls_30,
       count(*) filter (where cost_micros is null)::integer as unpriced_30
from core.model_spend
where created_at >= now() - interval '30 days'
group by user_id, module;

revoke all on core.workspace_spend from anon;
grant select on core.workspace_spend to authenticated, service_role;
