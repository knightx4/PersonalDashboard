-- Where the morning brief is sent as a phone notification (plan #1124).
--
-- A row is one browser that said yes to notifications: the home-screen app on
-- an iPhone, or a desktop browser. The switch on the account page asks the
-- browser for permission, subscribes it to web push with the app's VAPID
-- public key, and stores what the browser hands back. Turning the switch off
-- deletes the row. When the brief is written (lib/day-brief/run.ts, `written`)
-- the run sends to every row the person has, and a push service that answers
-- 404 or 410 has forgotten the subscription, so its row is deleted then.
--
-- Columns
--
--   endpoint    the push service URL for this browser; unique, because a
--               browser that subscribes again gets the same one back
--   p256dh      the browser's public key, base64url, that the message is
--               encrypted to
--   auth        the browser's auth secret, base64url
--   user_agent  what the browser said it was, so the account page can name
--               the device
--   last_sent_at  when a notification last reached the push service
--
-- Bookkeeping, so not a source for Goals (lib/core/sources.ts). The person
-- reads, adds and removes their own rows from the account page; the brief run
-- reads and deletes with the service role.

set search_path = core, public, extensions;

create table if not exists core.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  constraint push_subscriptions_endpoint_ck check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  constraint push_subscriptions_keys_ck check (
    length(p256dh) between 1 and 200 and length(auth) between 1 and 100
  ),
  constraint push_subscriptions_user_agent_ck check (user_agent is null or length(user_agent) <= 500)
);

create unique index if not exists push_subscriptions_endpoint_uq
  on core.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_idx
  on core.push_subscriptions (user_id);

alter table core.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select on core.push_subscriptions;
create policy push_subscriptions_select on core.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on core.push_subscriptions;
create policy push_subscriptions_insert on core.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_update on core.push_subscriptions;
create policy push_subscriptions_update on core.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on core.push_subscriptions;
create policy push_subscriptions_delete on core.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on core.push_subscriptions to authenticated;
grant update (p256dh, auth, user_agent) on core.push_subscriptions to authenticated;
grant select, insert, update, delete on core.push_subscriptions to service_role;

comment on table core.push_subscriptions is
  'Browsers that accepted notifications; the morning brief is sent to each (plan #1124).';
