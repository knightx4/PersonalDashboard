-- The model this account's People bots write with, apart from Dash's.
--
-- Until now every bot replied with the model chosen for Dash
-- (core.account_settings.dash_model). An account that put Dash on Opus for
-- hard questions had every text to every bot answered by Opus as well, and
-- bot replies became most of the account's spend. The bots get their own
-- pick, on the Bots tab in Chat.
--
-- Null means no choice, which reads as the default, Sonnet (BOT_MODEL in
-- lib/dash/model-choice.ts). The check names the three ids in
-- lib/core/models.ts, as account_settings_dash_model_ck does.
--
-- Schema only: no existing row is touched, and every account starts at null.

set search_path = core, public, extensions;

alter table core.account_settings
  add column bot_model text;

alter table core.account_settings
  add constraint account_settings_bot_model_ck
    check (bot_model is null or bot_model in (
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5'
    ));

comment on column core.account_settings.bot_model is
  'The Claude model this account''s People bots write with: one of the three ids in lib/core/models.ts, or null for the default (Sonnet). Read by lib/dash/model-choice.ts botModelFor.';

notify pgrst, 'reload schema';
