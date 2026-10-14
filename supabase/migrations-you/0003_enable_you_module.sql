-- Turn the You workspace on for accounts that already exist (plan #1991.1).
-- Same shape as migrations-goals/0002: the default for new accounts names
-- every workspace, and existing rows gain `you` unless they already have it.
-- A workspace somebody switched off stays off, and running it twice changes
-- nothing.

alter table core.account_settings
  alter column enabled_modules
  set default array['shopping', 'jobs', 'vault', 'todo', 'learn', 'news', 'goals', 'you', 'dev'];

update core.account_settings
set enabled_modules = array_append(enabled_modules, 'you')
where not (enabled_modules @> array['you']);
