-- Turn the goals workspace on for accounts that already exist (plan #923).
--
-- `core.account_settings.enabled_modules` is a list a person edits, so a
-- module added to lib/modules.ts appears in nobody's switcher until their row
-- names it. Same shape as migrations-learn/0002 and migrations/0049.
--
-- The default for new accounts names every module that exists now. It had
-- fallen behind by one: `news` was switched on by hand and never added, so an
-- account created since would have started without it.
--
-- Additive: a workspace somebody switched off stays off, and the guard makes
-- running it twice a no-op.

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'dev'];

update core.account_settings
set enabled_modules = array_append(enabled_modules, 'goals')
where not (enabled_modules @> array['goals']);
