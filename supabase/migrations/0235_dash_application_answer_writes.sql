-- Ask Dash keeps an application's questions and answers when asked
-- (plan #1894.6.8):
--
--   add_application_questions  questions an application asks, added to it
--                              and to the question bank.
--   save_answer                an answer saved, kept as a draft with what it
--                              rests on, approved or marked submitted.
--   set_default_answer         the answer reused for a question on every
--                              application.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by these three. Other steps of #1894.6 were adding kinds in the same hours,
-- so the list is read from the constraint as it stands when this runs and
-- these three are added to it, rather than written out in full: a list
-- written out here would take away any kind another migration added first.

set search_path = core, public, extensions;

do $$
declare
  kinds text[];
  listed text;
begin
  select coalesce(array_agg(distinct m[1]), '{}')
    into kinds
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([a-z][a-z0-9_]*)''::text', 'g') as m
   where c.conrelid = 'core.dash_actions'::regclass
     and c.conname = 'dash_actions_kind_ck'
     and m[1] <> 'ask';

  -- A list that came back short means the constraint was not read; stop
  -- rather than shrink it to three kinds.
  if cardinality(kinds) < 50 then
    raise exception 'dash_actions_kind_ck read back % kinds; expected the full list', cardinality(kinds);
  end if;

  -- Written back as a list of literals, so the constraint reads as the
  -- earlier ones do and the next migration can read it the same way.
  select string_agg(quote_literal(k), ', ' order by k)
    into listed
    from (
      select distinct k
        from unnest(kinds || array['add_application_questions', 'save_answer', 'set_default_answer']) as k
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
