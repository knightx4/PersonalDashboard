-- Ask Dash makes a new role from an email waiting in Jobs review when asked
-- (plan #1894.6.4.3):
--
--   add_role_from_email  a role and its application made from an email, with
--                        the email linked to it.
--
-- Linking a review email to a role on file is change_role_email, whose kind
-- is on the list already.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by this one. Other steps add kinds in the same hours, so the list is read
-- from the constraint as it stands when this runs and the kind added to it.
--
-- Postgres now prints the list back as one array literal,
-- kind = ANY ('{a,b,...}'::text[]), where 0233 to 0235 read a list of
-- quoted literals. Both forms are read here, so whichever the constraint
-- holds, no kind is lost.

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
    from (select distinct k from unnest(kinds || array['add_role_from_email']) as k) s;

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute
    'alter table core.dash_actions add constraint dash_actions_kind_ck check ('
    || 'kind ~ ''^[a-z][a-z0-9_]*$'' and (surface <> ''ask'' or kind in (' || listed || ')))';
end;
$$;

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
