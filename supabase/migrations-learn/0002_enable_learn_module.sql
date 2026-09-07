-- Turn the learn module on for accounts that already exist.
--
-- `core.account_settings.enabled_modules` is a stored array, not a computed
-- one, so adding a fifth module to lib/modules.ts does not make it appear in
-- anybody's switcher: an account created before today holds
-- {shopping,jobs,vault,todo} and would keep holding it. The module would be
-- reachable by typing /learn and invisible everywhere else, which reads as a
-- bug rather than as a setting.
--
-- Two halves, and both are needed. The default is for accounts created from
-- now on; the update is for the ones already there.
--
-- Deliberately additive. Anyone who has switched a module OFF keeps it off --
-- `array_append` only adds `learn`, and re-running this migration is a no-op
-- because of the `not (... @> ...)` guard. A blanket reset to all five would
-- undo a choice somebody made on purpose.

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'learn'];

update core.account_settings
set enabled_modules = array_append(enabled_modules, 'learn')
where not (enabled_modules @> array['learn']);
