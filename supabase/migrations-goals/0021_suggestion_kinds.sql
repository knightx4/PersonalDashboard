-- ===========================================================================
-- Each suggestion says which kind of help it is (plan #1028).
--
-- The weekly run used to research one thing, NYC events. It now researches
-- every kind of help a goal asks for (items.help_kinds, 0019), so one run can
-- write events for the city goal and reading for a learning goal. The next
-- week's brief lists past reactions per kind, which needs the kind on the row:
--
--   suggestions.kind   one of events, volunteering, reading, courses and
--                      job_leads, the same set 0019 checks help_kinds against.
--
-- Rows written before this were all from the events research, so they are
-- filled in as events. The default is then dropped, so a run that forgets the
-- kind is refused rather than filed under events.
-- ===========================================================================

alter table goals.suggestions
  add column kind text not null default 'events';

alter table goals.suggestions
  alter column kind drop default;

alter table goals.suggestions
  add constraint suggestions_kind_ck check (
    kind in ('events', 'volunteering', 'reading', 'courses', 'job_leads')
  );

comment on column goals.suggestions.kind is
  'The kind of weekly help this suggestion is (plan #1028): events, volunteering, reading, courses or job_leads, matching the kinds on goals.items.help_kinds.';
