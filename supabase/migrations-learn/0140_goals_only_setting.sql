-- Whether Learn draws from your goals alone (plan #2164.1). While it is on,
-- Now's deck draws no vault theme or gap field, the cards already picked for
-- one are left out of the deal, and Practice Flow asks no survey question and
-- opens on Goals only. Set from Learn settings; on by default.

alter table learn.settings
  add column if not exists goals_only boolean not null default true;

comment on column learn.settings.goals_only is
  'Whether Now and Practice Flow draw from your goals alone, leaving out vault '
  'themes, gap fields and survey subjects. Set from Learn settings; true by default.';
