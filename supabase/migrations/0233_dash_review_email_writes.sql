-- Ask Dash dismisses emails waiting in Jobs review, and brings dismissed
-- ones back, when asked (plan #1894.6.4.2):
--
--   review_emails  emails dismissed from the queue, or put back in it.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by this one. Several steps add kinds at once, so the list is read from the
-- constraint as it stands and this kind added to it, rather than written out
-- whole: whichever order the steps land in, none loses another's kind.

set search_path = core, public, extensions;

do $$
declare
  kinds text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}')
    into kinds
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z][a-z0-9_]*)''::text', 'g') as m
   where c.conrelid = 'core.dash_actions'::regclass
     and c.conname = 'dash_actions_kind_ck'
     and m[1] <> 'ask';

  -- The list has held dozens of kinds since 0164; finding a handful means the
  -- constraint was not read, and writing it back would refuse Ask's records.
  if cardinality(kinds) < 20 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the live list', cardinality(kinds);
  end if;

  if not ('review_emails' = any (kinds)) then
    kinds := array_append(kinds, 'review_emails');
  end if;

  -- Written out as a list of literals, as the earlier migrations wrote it, so
  -- the constraint reads back in the form the select above parses.
  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute format(
    'alter table core.dash_actions add constraint dash_actions_kind_ck check (
       kind ~ %L and (surface <> %L or kind in (%s)))',
    '^[a-z][a-z0-9_]*$', 'ask',
    (select string_agg(quote_literal(k), ', ') from unnest(kinds) as k)
  );
end;
$$;

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
