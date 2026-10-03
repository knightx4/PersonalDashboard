-- Let core.account_settings.theme hold every theme the picker can store.
--
-- The check from 0046 lists five names: paper, ink, riso, lightbox, dusk.
-- lib/theme.ts has since added darkroom, aurora, dawn, poster and
-- poster-dark, and stores a choice with a colour as `mode:colour`
-- (`dark:284`, `aurora:polar`, `poster:<palette>`). Every save of any of those
-- fails the check. setTheme() treats the write as best effort and ignores the
-- error, so the cookie changes and the account does not: the Postgres log
-- shows 83 failed upserts on 3 October 2026 alone, and the owner's row still
-- reads `lightbox`.
--
-- The value is already normalised before it is written: formatTheme(
-- parseTheme(x)) returns one of the app's own spellings or null. So the check
-- now guards the shape rather than the list, and adding a theme stops needing
-- a migration, which is what 0046 said it wanted.
--
--   a lowercase name of letters and hyphens, optionally `:` and a colour
--   (letters, digits, hyphens), 40 characters at most.
--
-- Every value in the table today (null and 'lightbox') passes the new check.

alter table core.account_settings
  drop constraint if exists account_settings_theme_check;

alter table core.account_settings
  add constraint account_settings_theme_check
    check (
      theme is null
      or (char_length(theme) <= 40 and theme ~ '^[a-z][a-z-]*(:[a-z0-9-]+)?$')
    );
