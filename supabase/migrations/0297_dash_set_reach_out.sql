-- Ask Dash sets what a person on People texts the owner about when asked
-- (plan #2931.4):
--
--   set_reach_out  the reach-out brief, rule and summary on one you.board_advisors
--                  row, undone by putting the earlier values back.
--
-- As 0295 did, the kind list is read from the constraint as it stands when
-- this runs and the one kind added, so no kind added by another step in the
-- same hours is lost. Both forms Postgres prints the list in are read.

set search_path = core, public, extensions;

do $$
declare
  def text;
  kinds text[];
  listed text;
begin
  select pg_get_constraintdef(c.oid)
    into def
    from pg_constraint c
   where c.conrelid = 'core.dash_actions'::regclass
     and c.conname = 'dash_actions_kind_ck';

  if def is null then
    raise exception 'dash_actions_kind_ck was not found';
  end if;

  select coalesce(array_agg(distinct k), '{}')
    into kinds
    from (
      select unnest(string_to_array(m[1], ',')) as k
        from regexp_matches(def, '''\{([a-z0-9_,]*)\}''::text\[\]', 'g') as m
      union
      select m[1]
        from regexp_matches(def, '''([a-z][a-z0-9_]*)''::text(?!\[)', 'g') as m
    ) s
   where k ~ '^[a-z][a-z0-9_]*$' and k <> 'ask';

  if cardinality(kinds) < 80 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the full list', cardinality(kinds);
  end if;

  select string_agg(quote_literal(k), ', ' order by k)
    into listed
    from (select distinct k from unnest(kinds || array['set_reach_out']) as k) s;

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute
    'alter table core.dash_actions add constraint dash_actions_kind_ck check ('
    || 'kind ~ ''^[a-z][a-z0-9_]*$'' and (surface <> ''ask'' or kind in (' || listed || ')))';
end;
$$;

notify pgrst, 'reload schema';
