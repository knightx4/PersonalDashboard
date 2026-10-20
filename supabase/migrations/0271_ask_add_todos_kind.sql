-- Ask Dash adds one todo for each row a lookup found (plan #2472.4):
--
--   add_todos  a todo.tasks row for every row of a set query_rows named,
--              each about its row through todo.task_links where a todo can
--              point at that table. One record keeps every todo it made in
--              undo.rows, and its Undo takes out the ones still untouched
--              (lib/dash/todo-writes.ts, undoAddedTodos).
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by this one. As in 0258, the list is read from the constraint as it stands
-- when this runs and the kind is added to it, so kinds other steps added in
-- the same hours are kept, and a list that comes back short stops the
-- migration rather than shrinking the check.

set search_path = core, public, extensions;

do $$
declare
  def text;
  kinds text[];
  listed text;
begin
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'core.dash_actions'::regclass
     and c.conname = 'dash_actions_kind_ck';

  select coalesce(array_agg(distinct k), '{}') into kinds
    from (
      -- '{a,b,c}'::text[]
      select unnest(string_to_array(m[1], ',')) as k
        from regexp_matches(coalesce(def, ''), '''\{([a-z0-9_,]*)\}''::text\[\]', 'g') as m
      union
      -- 'a'::text, 'b'::text
      select m[1]
        from regexp_matches(coalesce(def, ''), '''([a-z][a-z0-9_]*)''::text', 'g') as m
    ) s
   where k ~ '^[a-z][a-z0-9_]*$' and k <> 'ask';

  if cardinality(kinds) < 50 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the full list', cardinality(kinds);
  end if;

  select string_agg(quote_literal(k), ', ' order by k) into listed
    from (
      select distinct k
        from unnest(kinds || array['add_todos']) as k
    ) s;

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute
    'alter table core.dash_actions add constraint dash_actions_kind_ck check ('
    || 'kind ~ ''^[a-z][a-z0-9_]*$'' and (surface <> ''ask'' or kind in (' || listed || ')))';
end;
$$;

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
