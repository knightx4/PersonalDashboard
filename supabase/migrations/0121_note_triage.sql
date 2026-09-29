-- Triage for a note or an idea at the moment it is filed (plan #1179).
--
-- The header panel asks Jev four questions about what was just filed: bug or
-- request, which workspace, how soon, and whether an open note or idea already
-- says the same thing. The answers, each with Jev's confidence, are kept on
-- the row so the queue and the ideas page can show them without asking again.
-- Shape and reading: lib/feedback/triage.ts (`Triage`, `triageFrom`).
--
-- One jsonb column on each table rather than four typed ones: every answer
-- carries a confidence and may be missing, the duplicate names a row in either
-- table, and none of it is filtered or joined on. Null means not triaged: a
-- row filed before this, by an account that has not agreed to send text to
-- Jev, or while Jev was unreachable.

alter table public.feedback_items add column triage jsonb;
alter table public.ideas add column triage jsonb;

comment on column public.feedback_items.triage is
  'Jev''s triage when the note was filed: kind, module, priority and a likely duplicate, each with a confidence (plan #1179). Read by lib/feedback/triage.ts.';
comment on column public.ideas.triage is
  'Jev''s triage when the idea was filed: kind, module, priority and a likely duplicate, each with a confidence (plan #1179). Read by lib/feedback/triage.ts.';
