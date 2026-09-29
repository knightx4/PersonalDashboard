-- Whether this account's text may be sent to TypeSafe's Jev (plan #1166).
--
-- Feature #1161 moves the app's pick-one and yes/no calls to Jev, a hosted
-- classifier, so every email and note those calls read leaves for TypeSafe.
-- The plan owner agreed to that on decision #1163. Nobody else has, and a
-- second active account exists, so the column defaults to false and each
-- rollout step asks lib/jev/enabled.ts before calling Jev. An account that
-- has not opted in keeps the Haiku path it had, and no call reaches TypeSafe.
--
-- On core.account_settings rather than a table of its own: it is a fact about
-- the account that holds in every workspace, which is what that table is for,
-- and every account already has a row there.

set search_path = core, public, extensions;

alter table core.account_settings
  add column jev_enabled boolean not null default false;

comment on column core.account_settings.jev_enabled is
  'True when this account agreed to have its text sent to TypeSafe''s Jev classifier (plan #1163). Read by lib/jev/enabled.ts.';

-- The one account that agreed (#1163).
update core.account_settings
   set jev_enabled = true
 where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';
