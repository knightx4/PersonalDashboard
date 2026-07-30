-- Display currency preference + historical FX rate cache.
--
-- Orders keep their native currency + cents. The profile display_currency
-- controls how amounts are shown (and how dashboard spend is aggregated).
-- Rates are fetched from Frankfurter by purchase date and cached here.

set search_path = public, extensions;

alter table profiles
  add column if not exists display_currency text not null default 'USD';

alter table profiles
  drop constraint if exists profiles_display_currency_ck;

alter table profiles
  add constraint profiles_display_currency_ck
  check (char_length(display_currency) = 3);

create table if not exists fx_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null,
  base_currency text not null,
  quote_currency text not null,
  -- quote units per 1 base unit (e.g. HKD→USD ≈ 0.12761)
  rate numeric not null,
  source text not null default 'frankfurter',
  created_at timestamptz not null default now(),
  constraint fx_rates_base_ck check (char_length(base_currency) = 3),
  constraint fx_rates_quote_ck check (char_length(quote_currency) = 3),
  constraint fx_rates_rate_ck check (rate > 0),
  constraint fx_rates_pair_date_key unique (rate_date, base_currency, quote_currency)
);

create index if not exists fx_rates_lookup_idx
  on fx_rates (base_currency, quote_currency, rate_date desc);

alter table fx_rates enable row level security;

grant select, insert, update on table fx_rates to authenticated;

-- Public market data: any signed-in user may read and refresh the cache.
drop policy if exists fx_rates_select on fx_rates;
create policy fx_rates_select on fx_rates for select to authenticated
  using (true);

drop policy if exists fx_rates_insert on fx_rates;
create policy fx_rates_insert on fx_rates for insert to authenticated
  with check (true);

drop policy if exists fx_rates_update on fx_rates;
create policy fx_rates_update on fx_rates for update to authenticated
  using (true) with check (true);

-- No delete policy: rates are append/upsert only.
