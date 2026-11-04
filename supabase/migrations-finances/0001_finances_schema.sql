-- The finances schema: every account the person holds, wherever its numbers
-- come from, with its balance history, transactions and investment holdings
-- (plan #2593.2).
--
-- Five tables:
--
--   links             one per Plaid Item: a sign-in at one institution.
--   accounts          checking, savings, credit card, brokerage or loan.
--   balance_readings  one balance per account per day.
--   transactions      money in and out of an account.
--   holdings          what a brokerage account holds, as of a date.
--
-- Money is integer cents in bigint columns. Two sign rules, written once here
-- so every reader agrees:
--
--   balance_readings.balance_cents is the balance as the institution states
--   it. For a credit card or a loan that is the amount owed, as a positive
--   number. Net worth subtracts the balances of those two kinds.
--
--   transactions.amount_cents is positive for money into the account and
--   negative for money out of it, whatever the kind. Plaid reports the
--   opposite sign, so its sync flips the sign on the way in.
--
-- Every child table points at its account by a composite foreign key carrying
-- user_id, as news.issues does, because a foreign key ignores row level
-- security and a bare `references accounts (id)` would accept another
-- account's row.
--
-- Applied by scripts/db-reset.sh after migrations-you. Transactions point at
-- public.orders and public.recurring_payments, so this set comes after public.

create schema if not exists finances;

set search_path = finances, public, extensions;

-- ---------------------------------------------------------------------------
-- links: one Plaid Item each.
--
-- The access token is encrypted with lib/crypto/tokens.ts before it is
-- written, and the column refuses anything without that format's prefix.
-- The signed-in person cannot read the column at all (see the grants at the
-- foot of this file): only the server, through the service role, decrypts it.
-- ---------------------------------------------------------------------------
create table finances.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Plaid's item_id, and the institution as Plaid names it.
  plaid_item_id text not null,
  institution_id text,
  institution_name text not null,

  access_token text not null,
  -- The cursor /transactions/sync hands back; null before the first sync.
  sync_cursor text,

  status text not null default 'active',
  -- Plaid's ITEM_LOGIN_REQUIRED and PENDING_EXPIRATION: the person has to
  -- sign in again through Link in update mode before syncing resumes.
  needs_update boolean not null default false,
  last_error text,
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint links_plaid_item_ck check (btrim(plaid_item_id) <> ''),
  constraint links_institution_name_ck check (btrim(institution_name) <> '' and length(institution_name) <= 200),
  constraint links_access_token_ck check (access_token like 'v1:%'),
  constraint links_status_ck check (status in ('active', 'error', 'removed')),
  constraint links_user_item_key unique (user_id, plaid_item_id),
  constraint links_id_user_key unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- accounts
--
-- `source` says where the numbers come from: plaid (synced through a link),
-- import (a statement file, such as Apple Card's), goals (a balance the goals
-- workspace already tracks) or manual (typed in).
--
-- A Plaid account keeps its rows when its link is removed: link_id goes null
-- and the history stays.
-- ---------------------------------------------------------------------------
create table finances.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  link_id uuid,

  name text not null,
  official_name text,
  institution_name text,
  -- The last digits the institution shows, for telling two cards apart.
  mask text,

  kind text not null,
  source text not null,
  plaid_account_id text,
  currency text not null default 'USD',

  -- Credit cards only.
  credit_limit_cents bigint,

  -- Loans only. The rate is the annual percentage, 6.54 for 6.54%.
  interest_rate numeric(6, 3),
  minimum_payment_cents bigint,
  next_payment_due_on date,

  -- Hidden from totals and lists without losing its history.
  hidden boolean not null default false,
  closed_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_link_fk foreign key (link_id, user_id)
    references finances.links (id, user_id) on delete set null (link_id),

  constraint accounts_name_ck check (btrim(name) <> '' and length(name) <= 200),
  constraint accounts_mask_ck check (mask is null or mask ~ '^[0-9A-Za-z]{1,8}$'),
  constraint accounts_kind_ck check (kind in ('checking', 'savings', 'credit_card', 'brokerage', 'loan')),
  constraint accounts_source_ck check (source in ('plaid', 'import', 'goals', 'manual')),
  constraint accounts_plaid_ck check ((source = 'plaid') = (plaid_account_id is not null)),
  constraint accounts_link_source_ck check (link_id is null or source = 'plaid'),
  constraint accounts_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint accounts_credit_limit_ck check (
    credit_limit_cents is null or (kind = 'credit_card' and credit_limit_cents >= 0)
  ),
  constraint accounts_loan_fields_ck check (
    kind = 'loan' or num_nonnulls(interest_rate, minimum_payment_cents, next_payment_due_on) = 0
  ),
  constraint accounts_interest_rate_ck check (interest_rate is null or interest_rate between 0 and 100),
  constraint accounts_minimum_payment_ck check (minimum_payment_cents is null or minimum_payment_cents >= 0),
  -- Full unique constraints rather than partial indexes throughout, so a
  -- supabase-js upsert can name them in onConflict. Nulls never collide.
  constraint accounts_user_plaid_key unique (user_id, plaid_account_id),
  constraint accounts_id_user_key unique (id, user_id)
);

create index accounts_user_kind_idx on finances.accounts (user_id, kind);
create index accounts_link_idx on finances.accounts (link_id) where link_id is not null;

-- ---------------------------------------------------------------------------
-- balance_readings: one per account per day.
--
-- A second reading on the same day replaces the first (upsert on
-- account_id, read_on), so the history is a balance a day, not a reading per
-- sync. Linked accounts read daily; imported ones once a statement.
-- ---------------------------------------------------------------------------
create table finances.balance_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,

  read_on date not null,
  balance_cents bigint not null,
  -- What can be spent or borrowed now, when the institution says.
  available_cents bigint,

  created_at timestamptz not null default now(),

  constraint balance_readings_account_fk foreign key (account_id, user_id)
    references finances.accounts (id, user_id) on delete cascade,
  constraint balance_readings_account_day_key unique (account_id, read_on)
);

create index balance_readings_user_day_idx on finances.balance_readings (user_id, read_on desc);

-- ---------------------------------------------------------------------------
-- transactions
--
-- A Plaid transaction is keyed by its transaction_id and an imported one by
-- a fingerprint the importer computes from the statement line (date, amount,
-- description and its position among identical lines). Either key is unique,
-- so syncing or importing the same thing twice lands on the same row.
-- A manual entry has neither.
--
-- order_id and recurring_payment_id tie a charge to a Shopping order or a
-- recurring payment. They point into public, whose tables have no
-- (id, user_id) key to join on, so the trigger below checks the owner.
-- ---------------------------------------------------------------------------
create table finances.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,

  amount_cents bigint not null,
  posted_on date not null,
  authorized_on date,

  -- The description as the institution sent it, and the merchant cleaned up
  -- when there is one.
  description text not null,
  merchant text,
  category text,
  category_detail text,
  pending boolean not null default false,

  plaid_transaction_id text,
  import_fingerprint text,

  order_id uuid references public.orders (id) on delete set null,
  recurring_payment_id uuid references public.recurring_payments (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transactions_account_fk foreign key (account_id, user_id)
    references finances.accounts (id, user_id) on delete cascade,

  constraint transactions_description_ck check (btrim(description) <> ''),
  constraint transactions_merchant_ck check (merchant is null or btrim(merchant) <> ''),
  constraint transactions_one_key_ck check (num_nonnulls(plaid_transaction_id, import_fingerprint) <= 1),
  constraint transactions_user_plaid_key unique (user_id, plaid_transaction_id),
  constraint transactions_account_fingerprint_key unique (account_id, import_fingerprint)
);

create index transactions_user_posted_idx on finances.transactions (user_id, posted_on desc);
create index transactions_account_posted_idx on finances.transactions (account_id, posted_on desc);
create index transactions_order_idx on finances.transactions (order_id) where order_id is not null;
create index transactions_recurring_idx on finances.transactions (recurring_payment_id)
  where recurring_payment_id is not null;

create or replace function finances.check_transaction_links()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.order_id is not null and not exists (
    select 1 from public.orders o where o.id = new.order_id and o.user_id = new.user_id
  ) then
    raise exception 'order % does not belong to this account', new.order_id
      using errcode = '23503';
  end if;
  if new.recurring_payment_id is not null and not exists (
    select 1 from public.recurring_payments r
     where r.id = new.recurring_payment_id and r.user_id = new.user_id
  ) then
    raise exception 'recurring payment % does not belong to this account', new.recurring_payment_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

alter function finances.check_transaction_links() set search_path = '';
revoke all on function finances.check_transaction_links() from public, anon, authenticated;

create trigger transactions_check_links
  before insert or update of order_id, recurring_payment_id, user_id on finances.transactions
  for each row execute function finances.check_transaction_links();

-- ---------------------------------------------------------------------------
-- holdings: one security in one account, as of a date.
--
-- A snapshot per date, so value over time can be read back. security_id is
-- Plaid's; an imported holding has none and is told apart by ticker or name.
-- ---------------------------------------------------------------------------
create table finances.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,

  security_id text,
  ticker text,
  security_name text not null,
  quantity numeric(24, 8) not null,
  value_cents bigint not null,
  cost_basis_cents bigint,
  as_of date not null,
  -- What tells two holdings in one account apart: the upsert key with
  -- account_id and as_of.
  security_key text generated always as (coalesce(security_id, ticker, security_name)) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint holdings_account_fk foreign key (account_id, user_id)
    references finances.accounts (id, user_id) on delete cascade,
  constraint holdings_security_name_ck check (btrim(security_name) <> ''),
  constraint holdings_account_day_security_key unique (account_id, as_of, security_key)
);

create index holdings_user_as_of_idx on finances.holdings (user_id, as_of desc);

-- ---------------------------------------------------------------------------
-- updated_at, with the schema's own copy of the function as every other
-- schema has.
-- ---------------------------------------------------------------------------
create or replace function finances.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function finances.touch_updated_at() set search_path = finances;
revoke all on function finances.touch_updated_at() from public, anon, authenticated;

create trigger links_touch_updated_at before update on finances.links
  for each row execute function finances.touch_updated_at();
create trigger accounts_touch_updated_at before update on finances.accounts
  for each row execute function finances.touch_updated_at();
create trigger transactions_touch_updated_at before update on finances.transactions
  for each row execute function finances.touch_updated_at();
create trigger holdings_touch_updated_at before update on finances.holdings
  for each row execute function finances.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: every table, to its owner only. tests/rls-finances.test.ts
-- lists the tables, so one added later without a policy fails there.
-- ---------------------------------------------------------------------------
alter table finances.links enable row level security;
alter table finances.accounts enable row level security;
alter table finances.balance_readings enable row level security;
alter table finances.transactions enable row level security;
alter table finances.holdings enable row level security;

create policy links_all on finances.links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy accounts_all on finances.accounts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy balance_readings_all on finances.balance_readings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy transactions_all on finances.transactions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy holdings_all on finances.holdings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on all tables in schema finances from anon;

grant usage on schema finances to authenticated, service_role;
grant select, insert, update, delete on all tables in schema finances to service_role;
grant select, insert, update, delete
  on finances.accounts, finances.balance_readings, finances.transactions, finances.holdings
  to authenticated;

-- links: the signed-in person may see their links and remove one, but never
-- read the token, and links are written only by the server after Plaid's
-- token exchange.
revoke all on finances.links from authenticated;
grant select (
  id, user_id, plaid_item_id, institution_id, institution_name, sync_cursor, status,
  needs_update, last_error, last_synced_at, created_at, updated_at
) on finances.links to authenticated;
grant delete on finances.links to authenticated;
