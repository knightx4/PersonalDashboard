-- Core schema.
--
-- Conventions, applied without exception:
--   * every table has id uuid pk default gen_random_uuid(), created_at, updated_at
--     (exception: profiles.id is auth.users.id, one-to-one)
--   * money is integer cents, never numeric, never float
--   * every user-owned table has user_id uuid references auth.users not null
--   * order/inventory status columns are derived by lib/status.ts + public helpers,
--     never written ad hoc from a parser code path

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  -- so "this month" means the user's month, not the server's
  timezone text not null default 'UTC',
  -- Phase 2 fields, created now so Phase 2 needs no migration
  monthly_budget_cents int,
  default_cooldown_days int not null default 7,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories
--
-- user_id IS NULL means a system category. There is deliberately no is_system
-- flag: it would be redundant with the null check and the two could disagree.
-- ---------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  parent_id uuid references categories (id) on delete cascade,
  name text not null,
  slug text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- System slugs are globally unique; user slugs are unique per user.
create unique index categories_system_slug_key
  on categories (slug) where user_id is null;
create unique index categories_user_slug_key
  on categories (user_id, slug) where user_id is not null;
create index categories_parent_idx on categories (parent_id);

-- ---------------------------------------------------------------------------
-- merchants
--
-- Auto-discovered rows are scoped to their creator. A globally writable
-- merchant table is a cross-tenant write surface: one user's mangled merchant
-- name (or a name revealing where they shop) would be visible to everyone.
-- Promotion to global is a manual/offline job.
-- ---------------------------------------------------------------------------
create table merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  domains text[] not null default '{}',
  logo_url text,
  default_return_window_days int,
  created_by_user_id uuid references auth.users (id) on delete cascade,
  is_global boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a row is either global-and-unowned, or user-scoped-and-owned
  constraint merchants_scope_ck check (
    (is_global and created_by_user_id is null)
    or (not is_global and created_by_user_id is not null)
  )
);

create unique index merchants_global_slug_key
  on merchants (slug) where is_global;
create unique index merchants_user_slug_key
  on merchants (created_by_user_id, slug) where not is_global;
create index merchants_domains_idx on merchants using gin (domains);

-- ---------------------------------------------------------------------------
-- email_accounts
-- ---------------------------------------------------------------------------
create table email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider email_provider not null,
  email_address text not null,
  -- ciphertext only. See lib/crypto/tokens.ts; plaintext must never land here.
  oauth_refresh_token text,
  oauth_access_token text,
  token_expires_at timestamptz,
  -- Gmail historyId or Graph delta token
  sync_cursor text,
  last_synced_at timestamptz,
  status email_account_status not null default 'active',
  backfill_window_days int not null default 180,
  backfill_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_accounts_backfill_window_ck
    check (backfill_window_days between 30 and 730)
);

create unique index email_accounts_user_address_key
  on email_accounts (user_id, lower(email_address));
create index email_accounts_user_idx on email_accounts (user_id);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_id uuid references merchants (id) on delete set null,
  source order_source not null default 'email',
  external_order_number text,
  order_date date not null,
  subtotal_cents int not null default 0,
  tax_cents int not null default 0,
  shipping_cents int not null default 0,
  discount_cents int not null default 0,
  total_cents int not null default 0,
  currency text not null default 'USD',
  -- Input to the derived status. Nothing else sets order state directly.
  cancelled_at timestamptz,
  -- DERIVED. Maintained solely by public.sync_order_state(); see 0003.
  -- Never assign this from a parser or a route handler.
  status order_status not null default 'ordered',
  -- delivery date + merchants.default_return_window_days. Null when the
  -- merchant has no seeded window: a wrong deadline is worse than none.
  return_deadline date,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_currency_ck check (char_length(currency) = 3),
  constraint orders_date_sane_ck check (
    order_date <= (now() at time zone 'utc')::date + 1
    and order_date >= (now() at time zone 'utc')::date - 365 * 3
  )
);

-- The primary defense against duplicate orders when a confirmation email
-- arrives twice. Partial, because Postgres treats nulls as distinct and a
-- plain unique constraint would not dedupe anything.
create unique index orders_external_number_key
  on orders (user_id, merchant_id, external_order_number)
  where external_order_number is not null;

create index orders_user_date_idx on orders (user_id, order_date desc);
create index orders_user_status_idx on orders (user_id, status);
create index orders_merchant_idx on orders (merchant_id);
create index orders_needs_review_idx on orders (user_id) where needs_review;

-- ---------------------------------------------------------------------------
-- order_items
--
-- category_id here is the classifier's output and is never user-edited.
-- inventory_items.category_id is initialized from it and IS user-editable, and
-- is what every UI surface reads. Keeping both preserves training signal for
-- the classifier without losing what the user actually meant.
-- ---------------------------------------------------------------------------
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  category_id uuid references categories (id) on delete set null,
  name text not null,
  variant text,
  quantity int not null default 1,
  unit_price_cents int not null default 0,
  image_url text,
  product_url text,
  -- sha1(merchant_slug | normalize(name) | normalize(variant)) -- order dedupe
  fingerprint_strict text,
  -- sha1(normalize(name)) -- already-own / duplicate-purchase matching
  fingerprint_loose text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_items_quantity_ck check (quantity > 0)
);

create index order_items_order_idx on order_items (order_id);
create index order_items_fp_strict_idx on order_items (fingerprint_strict);
create index order_items_fp_loose_idx on order_items (fingerprint_loose);
create index order_items_name_trgm_idx on order_items using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- inventory_items
--
-- One row per physical unit. An order item with quantity 3 produces 3 rows.
-- Costs a few rows; makes returns, disposal and per-unit cost trivial instead
-- of requiring quantity arithmetic in every query.
-- ---------------------------------------------------------------------------
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_item_id uuid references order_items (id) on delete cascade,
  category_id uuid references categories (id) on delete set null,
  -- denormalized so manually added items work standalone
  name text not null,
  variant text,
  image_url text,
  acquired_at date,
  -- landed cost: unit price + this unit's proportional share of tax and
  -- shipping, less its share of discount. See lib/money.ts allocateLandedCost.
  cost_cents int not null default 0,
  status inventory_status not null default 'owned',
  disposed_at date,
  disposal_method disposal_method,
  disposal_proceeds_cents int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_disposal_ck check (
    (status = 'disposed') = (disposed_at is not null)
  )
);

create index inventory_user_status_idx on inventory_items (user_id, status);
create index inventory_order_item_idx on inventory_items (order_item_id);
create index inventory_category_idx on inventory_items (category_id);
create index inventory_name_trgm_idx on inventory_items using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- item_uses (Phase 2, created now so cost-per-use needs no migration)
-- ---------------------------------------------------------------------------
create table item_uses (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  used_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index item_uses_item_idx on item_uses (inventory_item_id);

-- ---------------------------------------------------------------------------
-- shipments
--
-- No carrier API in v1. Status comes from parsed emails only.
-- ---------------------------------------------------------------------------
create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  status shipment_status not null default 'pending',
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shipments_order_idx on shipments (order_id);
create unique index shipments_tracking_key
  on shipments (order_id, tracking_number) where tracking_number is not null;

-- ---------------------------------------------------------------------------
-- returns
--
-- Source of truth for return state. When a return reaches 'refunded' the
-- linked inventory_items.status is set to 'returned' by the status function.
-- Nothing else writes that value.
-- ---------------------------------------------------------------------------
create table returns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  inventory_item_id uuid references inventory_items (id) on delete set null,
  initiated_at date not null default current_date,
  -- amount actually refunded, not the item's sticker price: merchants
  -- routinely withhold original shipping or charge restocking fees
  refund_amount_cents int not null default 0,
  status return_status not null default 'initiated',
  refunded_at date,
  source_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint returns_refunded_ck check (
    (status = 'refunded') = (refunded_at is not null)
  )
);

create index returns_user_idx on returns (user_id);
create index returns_order_idx on returns (order_id);
create index returns_item_idx on returns (inventory_item_id);
create index returns_refunded_at_idx on returns (user_id, refunded_at)
  where status = 'refunded';

-- ---------------------------------------------------------------------------
-- saved_items
-- ---------------------------------------------------------------------------
create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_id uuid references merchants (id) on delete set null,
  url text not null,
  title text,
  image_url text,
  price_cents int,
  currency text not null default 'USD',
  -- loose deliberately: saving from one store and buying from another
  -- still matches
  fingerprint_loose text,
  status saved_item_status not null default 'saved',
  cooldown_until timestamptz,
  notes text,
  purchased_order_item_id uuid references order_items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_items_currency_ck check (char_length(currency) = 3)
);

create index saved_items_user_status_idx on saved_items (user_id, status);
create index saved_items_fp_loose_idx on saved_items (fingerprint_loose);

-- ---------------------------------------------------------------------------
-- price_checks (Phase 2)
-- ---------------------------------------------------------------------------
create table price_checks (
  id uuid primary key default gen_random_uuid(),
  saved_item_id uuid not null references saved_items (id) on delete cascade,
  price_cents int,
  in_stock boolean,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index price_checks_item_idx on price_checks (saved_item_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- ingested_messages
--
-- The audit + dedupe log for email. THE BODY IS NEVER STORED.
--
-- Subject retention rule: the pipeline scans far more mail than it keeps.
-- Persisting subjects and senders of unrelated personal mail contradicts the
-- privacy claim the product depends on and is a liability in a CASA
-- assessment for no product benefit. For 'not_relevant', only the message id,
-- received_at and classification are written. The constraint below enforces
-- that rather than trusting every write path to remember.
-- ---------------------------------------------------------------------------
create table ingested_messages (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references email_accounts (id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  received_at timestamptz,
  from_address text,
  subject text,
  classification message_classification,
  parse_status parse_status not null default 'pending',
  parse_confidence numeric(3, 2),
  parser_version text,
  resulting_order_id uuid references orders (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingested_confidence_ck check (
    parse_confidence is null or parse_confidence between 0 and 1
  ),
  -- MVP acceptance criterion 16, enforced by the database
  constraint ingested_not_relevant_is_bare_ck check (
    classification is distinct from 'not_relevant'
    or (subject is null and from_address is null and thread_id is null)
  )
);

-- What makes re-running a sync safe.
create unique index ingested_messages_provider_key
  on ingested_messages (email_account_id, provider_message_id);
create index ingested_messages_account_idx on ingested_messages (email_account_id);
create index ingested_messages_order_idx on ingested_messages (resulting_order_id);

alter table returns
  add constraint returns_source_message_fk
  foreign key (source_message_id) references ingested_messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- sync_jobs -- powers the sync progress UI; backfill takes minutes
-- ---------------------------------------------------------------------------
create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  email_account_id uuid not null references email_accounts (id) on delete cascade,
  type sync_job_type not null,
  status sync_job_status not null default 'queued',
  messages_seen int not null default 0,
  messages_classified int not null default 0,
  messages_parsed int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_jobs_account_idx on sync_jobs (email_account_id, created_at desc);
