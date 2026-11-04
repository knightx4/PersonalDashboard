-- core.app_settings.owner_user_id cascades with its account, as every other
-- reference to auth.users here does (tests/account-cascade.test.ts).
--
-- 0284 first went out with `on delete set null`. Deleting the owner's
-- account now deletes the settings row; core.app_settings is read as "no
-- owner" either way, and docs/SETUP.md sets the owner with an upsert.

alter table core.app_settings drop constraint if exists app_settings_owner_user_id_fkey;
alter table core.app_settings
  add constraint app_settings_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users (id) on delete cascade;
