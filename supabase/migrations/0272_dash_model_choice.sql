-- The model this account chose for Dash to answer with (plan #2458.1).
--
-- Feature #2458 lets the person pick Haiku, Sonnet or Opus in the Dash popup
-- and on the Dash page. The pick belongs to the account, so it follows them
-- across devices, and sits on core.account_settings with the other facts that
-- hold in every workspace.
--
-- Null means no choice, which reads as the default, Sonnet (DASH_MODELS.ask).
-- The check names the three ids in lib/core/models.ts; adding a tier there
-- means a new migration here, which is the point of a check.
--
-- Schema only: no existing row is touched, and every account starts at null.

set search_path = core, public, extensions;

alter table core.account_settings
  add column dash_model text;

alter table core.account_settings
  add constraint account_settings_dash_model_ck
    check (dash_model is null or dash_model in (
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5'
    ));

comment on column core.account_settings.dash_model is
  'The Claude model this account chose for Dash''s answers (plan #2458): one of the three ids in lib/core/models.ts, or null for the default (Sonnet). Read by lib/dash/model-choice.ts.';
