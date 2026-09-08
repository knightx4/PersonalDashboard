-- The Dev workspace, switched on for accounts that already exist.
--
-- `enabled_modules` is a list a person edits, not a list the code derives, so
-- a module added to lib/modules.ts does not appear in anyone's switcher until
-- their row says so. Without this, Dev would ship invisible to every account
-- that predates it -- which is every account. Same shape as
-- migrations-learn/0002, and for the same reason.
--
-- Deliberately additive: a workspace someone has switched off stays off, and
-- the guard makes re-running it a no-op. The default names every module that
-- exists as of this migration, `learn` included, because a default written
-- from a stale list is how a workspace quietly stops reaching new accounts.

set search_path = core, public, extensions;

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'learn', 'dev'];

update core.account_settings
set enabled_modules = array_append(enabled_modules, 'dev')
where not (enabled_modules @> array['dev']);
