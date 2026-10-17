-- Goals only is an opt-in (plan #2302.1). Practice Flow asks about every
-- prepared subject unless the person narrows it to the subjects their goals
-- point at, so a settings row made without the choice now reads as off.
--
-- Only the default changes. No existing row is rewritten: a row that says
-- true was either the old default or a choice, and nothing here can tell.

alter table learn.settings alter column goals_only set default false;

comment on column learn.settings.goals_only is
  'Whether Now and Practice Flow draw from your goals alone, leaving out vault '
  'themes, gap fields and survey subjects. Set from Learn settings; false by default.';
