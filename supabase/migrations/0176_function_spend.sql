-- Model spend per function over the last 7 and 30 days, for the Usage tab in
-- Dev (plan #1692). A function is a workspace and the operation it was doing,
-- the two columns core.model_spend records for every call. Beside
-- core.workspace_spend, which sums the same ledger by workspace alone.
--
-- A view for the same reason as that one: a month holds more rows than one
-- PostgREST request returns, and a sum cut short by the row cap would be a
-- wrong number shown as a right one. security_invoker, so the ledger's own
-- RLS keeps each person to their rows.

create view core.function_spend with (security_invoker = true) as
select user_id, module, operation,
       coalesce(sum(cost_micros) filter (where created_at >= now() - interval '7 days'), 0)::bigint as spend_7,
       coalesce(sum(cost_micros), 0)::bigint as spend_30,
       count(*)::integer as calls_30,
       count(*) filter (where cost_micros is null)::integer as unpriced_30
from core.model_spend
where created_at >= now() - interval '30 days'
group by user_id, module, operation;

revoke all on core.function_spend from anon;
grant select on core.function_spend to authenticated, service_role;
