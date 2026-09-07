-- Terminal is retired; Lightbox takes its place.
--
-- A theme is a set of CSS variables and adding one should not need a
-- migration, which is why this column is text with a check rather than an
-- enum. The check still has to move when the list does.
--
-- Anyone sitting on 'terminal' is moved to null rather than to a replacement:
-- null means "follow the system", which is the honest answer to "the thing you
-- picked no longer exists" and puts them somewhere they will recognise.
alter table core.account_settings
  drop constraint if exists account_settings_theme_check;

update core.account_settings set theme = null where theme = 'terminal';

alter table core.account_settings
  add constraint account_settings_theme_check
    check (theme is null or theme in ('paper', 'ink', 'riso', 'lightbox', 'dusk'));
