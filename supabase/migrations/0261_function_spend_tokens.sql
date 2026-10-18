-- core.function_spend_since also returns each function's input tokens split by
-- how they were billed over the 30-day window, for the prompt-cache hit rate
-- on the Usage tab (plan #2393.1). The return type changes, so the function
-- is dropped and made again; no rows are touched.
drop function if exists core.function_spend_since(timestamptz, timestamptz);

create function core.function_spend_since(p_since7 timestamptz, p_since30 timestamptz)
returns table (
  module text,
  operation text,
  spend_7 bigint,
  spend_30 bigint,
  calls_30 integer,
  unpriced_30 integer,
  input_tokens_30 bigint,
  cached_tokens_30 bigint,
  cache_write_tokens_30 bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.module, s.operation,
         coalesce(sum(s.cost_micros) filter (where s.created_at >= p_since7), 0)::bigint as spend_7,
         coalesce(sum(s.cost_micros), 0)::bigint as spend_30,
         count(*)::integer as calls_30,
         count(*) filter (where s.cost_micros is null)::integer as unpriced_30,
         coalesce(sum(s.input_tokens), 0)::bigint as input_tokens_30,
         coalesce(sum(s.cached_input_tokens), 0)::bigint as cached_tokens_30,
         coalesce(sum(s.cache_write_tokens), 0)::bigint as cache_write_tokens_30
  from core.model_spend s
  where s.created_at >= p_since30
  group by s.module, s.operation;
$$;

revoke all on function core.function_spend_since(timestamptz, timestamptz) from public, anon;
grant execute on function core.function_spend_since(timestamptz, timestamptz) to authenticated, service_role;

comment on function core.function_spend_since(timestamptz, timestamptz) is
  'Model spend and input token sums per function since two instants, the Usage tab''s 7- and 30-day windows (plans #2036.2, #2393.1).';
