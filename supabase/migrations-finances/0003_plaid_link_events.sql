-- Linking through Plaid (plan #2593.3): one live link per institution, and
-- the webhooks Plaid sends, kept for the daily sync to act on (#2593.4).

set search_path = finances, public, extensions;

-- ---------------------------------------------------------------------------
-- One live link per institution.
--
-- The Trial plan allows ten Items and a removed Item does not give its slot
-- back, so a second sign-in to a bank already linked spends a slot on nothing.
-- The settings page refuses one before Plaid creates it; this is the backstop
-- for the server's write after the token exchange. A removed link does not
-- count, so an institution can be linked again after its link is removed.
-- ---------------------------------------------------------------------------
create unique index links_user_institution_live_key
  on finances.links (user_id, institution_id)
  where institution_id is not null and status <> 'removed';

-- ---------------------------------------------------------------------------
-- plaid_events: one row per webhook Plaid sends about one of the person's
-- Items, after its Plaid-Verification signature has been checked.
--
-- The webhook route records the event and marks a link needing attention when
-- Plaid says its login has to be repeated; the sync in #2593.4 reads the rest
-- (new transactions, holdings, liabilities) and sets handled_at.
-- ---------------------------------------------------------------------------
create table finances.plaid_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  link_id uuid not null,

  webhook_type text not null,
  webhook_code text not null,
  -- Plaid's error code when the webhook carries one, such as
  -- ITEM_LOGIN_REQUIRED.
  error_code text,
  -- The webhook's JSON as Plaid sent it. It carries ids and codes, never the
  -- access token.
  body jsonb not null,

  received_at timestamptz not null default now(),
  handled_at timestamptz,

  constraint plaid_events_link_fk foreign key (link_id, user_id)
    references finances.links (id, user_id) on delete cascade,
  constraint plaid_events_type_ck check (btrim(webhook_type) <> '' and length(webhook_type) <= 64),
  constraint plaid_events_code_ck check (btrim(webhook_code) <> '' and length(webhook_code) <= 64)
);

create index plaid_events_unhandled_idx on finances.plaid_events (link_id, received_at)
  where handled_at is null;
create index plaid_events_user_received_idx on finances.plaid_events (user_id, received_at desc);

alter table finances.plaid_events enable row level security;

-- The person may read their own events; only the server writes them.
create policy plaid_events_select on finances.plaid_events for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on finances.plaid_events from anon, authenticated;
grant select on finances.plaid_events to authenticated;
grant select, insert, update, delete on finances.plaid_events to service_role;
