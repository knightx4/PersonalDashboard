-- Turn the Finances workspace on (plan #2593.1). Spending and Recurring moved
-- into it from Shopping, so an account with Finances off would find neither
-- in its switcher.
--
-- The default for new accounts names every workspace, Finances among them.
-- The existing row changed is the owner's alone, as every data change in a
-- migration now is (CLAUDE.md, "Only the owner's account is touched"); any
-- other account turns Finances on from the account page's Workspaces tab.
-- A row that already has it is left alone, so running this twice changes
-- nothing.

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'you', 'finances', 'dev'];

update core.account_settings
set enabled_modules = array_append(enabled_modules, 'finances')
where user_id = core.dev_owner_id()
  and not (enabled_modules @> array['finances']);
