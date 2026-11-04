-- Ask Dash changes the job search target titles and excluded industries
-- (plan #2608.1):
--
--   change_search_aim  the target titles or excluded industries Find shows.
--
-- The tool and its writer exist, but the kind was never on Ask's list, so
-- recording the change failed at the last step. As 0236 did, the list is read
-- from the constraint as it stands when this runs and the one kind added, so
-- no kind added by another step in the same hours is lost. Both forms
-- Postgres prints the list in are read.

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
      -- The array literal form: '{a,b,c}'::text[].
      select unnest(string_to_array(m[1], ',')) as k
        from regexp_matches(def, '''\{([a-z0-9_,]*)\}''::text\[\]', 'g') as m
      union
      -- The list of literals form: 'a'::text, 'b'::text.
      select m[1]
        from regexp_matches(def, '''([a-z][a-z0-9_]*)''::text(?!\[)', 'g') as m
    ) s
   where k ~ '^[a-z][a-z0-9_]*$' and k <> 'ask';

  -- The list has held dozens of kinds since 0164; finding a handful means the
  -- constraint was not read, and writing it back would refuse Ask's records.
  if cardinality(kinds) < 80 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the full list', cardinality(kinds);
  end if;

  select string_agg(quote_literal(k), ', ' order by k)
    into listed
    from (select distinct k from unnest(kinds || array['change_search_aim']) as k) s;

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute
    'alter table core.dash_actions add constraint dash_actions_kind_ck check ('
    || 'kind ~ ''^[a-z][a-z0-9_]*$'' and (surface <> ''ask'' or kind in (' || listed || ')))';
end;
$$;

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
