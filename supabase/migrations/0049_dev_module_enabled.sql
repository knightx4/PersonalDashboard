-- The Dev workspace, switched on for accounts that already exist.
--
-- `enabled_modules` is a list a person edits, not a list the code derives, so
-- a module added to lib/modules.ts does not appear in anyone's switcher until
-- their row says so. Without this, Dev would ship invisible to every account
-- that predates it -- which is every account.
--
-- Only added where it is missing, and nothing else in the array is touched: a
-- workspace someone has deliberately turned off stays off.

set search_path = core, public, extensions;

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'dev'];

update core.account_settings
set enabled_modules = enabled_modules || array['dev']
where not (enabled_modules @> array['dev']);
