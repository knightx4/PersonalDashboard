-- The theme the account chose, and the density it reads at.
--
-- Account-level rather than per-module, by the same rule as timezone and
-- display currency: it survives every module being switched off.
--
-- Null means "follow the system", which is the honest default -- it is not the
-- same as choosing light, and a person who has never opened the picker should
-- get whatever their OS is set to. Once they choose, the choice sticks and the
-- system preference stops mattering.
--
-- Deliberately a text column with a check rather than an enum: a theme is a set
-- of CSS variables, adding one is a stylesheet change, and needing a migration
-- to ship a colour scheme would be the wrong shape of friction.
alter table core.account_settings
  add column if not exists theme text
    check (theme is null or theme in ('paper', 'ink', 'riso', 'terminal', 'dusk'));

comment on column core.account_settings.theme is
  'Chosen theme, or null to follow prefers-color-scheme. Mirrored into a cookie so the server can render the right theme on first paint.';
