-- Ask Dash keeps the job search's material when asked (plan #1894.6.7):
--
--   add_evidence            a story added to the evidence bank.
--   add_resume_version      a resume version added, with a PDF sent to Dash.
--   attach_resume_pdf       a PDF sent to Dash kept as a version's file.
--   change_career_thought   a career goals entry written or reworded.
--   add_discovered_company  a startup Find discovered added to the companies.
--
-- Ask's kinds are the only ones checked, as 0164 set out, so the list grows
-- by these five. Several steps add kinds at once, so the list is not written
-- out here: it is every kind the live constraint names, whatever migration
-- put it there, with these five added.

set search_path = core, public, extensions;

do $$
declare
  def text;
  kinds text[];
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conname = 'dash_actions_kind_ck' and c.conrelid = 'core.dash_actions'::regclass;

  select coalesce(array_agg(m[1]), '{}') into kinds
  from regexp_matches(coalesce(substring(def from 'ARRAY\[(.*)\]'), ''), '''([a-z][a-z0-9_]*)''', 'g') as m;

  kinds := array(
    select distinct k from unnest(kinds || array[
      'add_evidence', 'add_resume_version', 'attach_resume_pdf',
      'change_career_thought', 'add_discovered_company'
    ]) as k
    order by k
  );

  alter table core.dash_actions drop constraint if exists dash_actions_kind_ck;
  execute format(
    'alter table core.dash_actions add constraint dash_actions_kind_ck check (kind ~ %L and (surface <> %L or kind = any (%L::text[])))',
    '^[a-z][a-z0-9_]*$', 'ask', kinds
  );
end
$$;

comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s kinds are checked; other surfaces name their own.';

notify pgrst, 'reload schema';
