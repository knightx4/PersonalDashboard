-- The log of what a connected Claude app read, and the apps whose access was
-- removed (plan #1254).
--
-- Feature #1244 lets Claude on the person's phone or desktop call Ask Dash's
-- lookups through an MCP connector, with a token from Supabase's OAuth server.
-- Every call is written here with what it read, so the account page can show
-- each connected app, every call it made and each row it returned (#1258).
-- The same rows are what the rate cap counts: 30 calls a minute and 1,000 a
-- day per person (lib/connector/calls.ts).
--
-- core.connector_calls, one row per tool call:
--   client_id    the OAuth client the token was issued to (its client_id
--                claim). Text, not a foreign key: the client lives in
--                Supabase's auth schema, which the app does not own.
--   client_name  what the client called itself when it registered, when the
--                route knows it; the list of grants names it otherwise.
--   tool         the lookup called, one of the seven in lib/ask/tools.ts.
--                Not checked against that list here, so adding a lookup does
--                not need a migration.
--   input        the arguments the client sent.
--   reads        each row the call returned, as {table, ref, title, href}:
--                the citation shape Ask Dash stores on its turns.
--   outcome      'ok' when the lookup answered, 'error' when it refused or
--                failed (error says why), 'limited' when the cap refused it
--                before it ran. The cap counts every outcome but 'limited', so
--                a client that keeps calling while capped is let back in once
--                the window has moved on.
--
-- core.connector_revocations, one row each time the person removes an app:
-- revoking a grant stops refresh at once, but an access token already issued
-- stays valid for up to an hour, so the route refuses any token for that
-- client issued before the newest row here (#1255).
--
-- Both are bookkeeping and append-only: the owner may read and insert their
-- own rows, nobody may rewrite one, and they go with the account.

set search_path = core, public, extensions;

create table core.connector_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  client_id text not null,
  client_name text,
  tool text not null,
  input jsonb not null default '{}'::jsonb,
  reads jsonb not null default '[]'::jsonb,
  outcome text not null,
  error text,

  created_at timestamptz not null default clock_timestamp(),

  constraint connector_calls_client_ck check (btrim(client_id) <> ''),
  constraint connector_calls_tool_ck check (btrim(tool) <> ''),
  constraint connector_calls_input_ck check (jsonb_typeof(input) = 'object'),
  constraint connector_calls_reads_ck check (jsonb_typeof(reads) = 'array'),
  constraint connector_calls_outcome_ck check (outcome in ('ok', 'error', 'limited')),
  -- An answer carries no error; a refusal says why and read nothing.
  constraint connector_calls_error_ck check (
    case outcome
      when 'ok' then error is null
      else error is not null and reads = '[]'::jsonb
    end
  )
);

-- The rate cap's two windows, and the account page's list, newest first.
create index connector_calls_user_created_idx on core.connector_calls (user_id, created_at desc);

create table core.connector_revocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  revoked_at timestamptz not null default clock_timestamp(),

  constraint connector_revocations_client_ck check (btrim(client_id) <> '')
);

-- The newest revoke for a client, which the route compares a token's iat with.
create index connector_revocations_client_idx
  on core.connector_revocations (user_id, client_id, revoked_at desc);

alter table core.connector_calls enable row level security;
alter table core.connector_revocations enable row level security;

create policy connector_calls_select on core.connector_calls for select to authenticated
  using (user_id = (select auth.uid()));
create policy connector_calls_insert on core.connector_calls for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy connector_revocations_select on core.connector_revocations for select to authenticated
  using (user_id = (select auth.uid()));
create policy connector_revocations_insert on core.connector_revocations for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on core.connector_calls from anon, authenticated;
revoke all on core.connector_revocations from anon, authenticated;
grant select, insert on core.connector_calls to authenticated;
grant select, insert on core.connector_revocations to authenticated;
grant all on core.connector_calls to service_role;
grant all on core.connector_revocations to service_role;

comment on table core.connector_calls is
  'Each tool call a connected Claude app made through the MCP connector, with what it read; the rate cap counts these (plan #1254).';
comment on column core.connector_calls.reads is
  'Each row the call returned, as {table, ref, title, href}.';
comment on column core.connector_calls.outcome is
  'ok, error (the lookup refused or failed), or limited (the rate cap refused it before it ran).';
comment on table core.connector_revocations is
  'Each time the person removed a connected app; tokens for that client issued before revoked_at are refused (plan #1254).';
