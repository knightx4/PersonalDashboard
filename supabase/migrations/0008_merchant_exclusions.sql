-- Merchant exclusions: learn-once mute for import noise (Uber Eats, Toast, …).
-- Survives Reset & re-scan; sync skips matching merchants/domains forever until undone.

set search_path = public, extensions;

create table merchant_exclusions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_id uuid references merchants (id) on delete cascade,
  /** Sender domain fallback when an order has no merchant row. */
  match_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_exclusions_target_ck check (
    merchant_id is not null or match_domain is not null
  )
);

create unique index merchant_exclusions_user_merchant_uidx
  on merchant_exclusions (user_id, merchant_id)
  where merchant_id is not null;

create unique index merchant_exclusions_user_domain_uidx
  on merchant_exclusions (user_id, match_domain)
  where match_domain is not null;

create index merchant_exclusions_user_idx on merchant_exclusions (user_id);

create trigger merchant_exclusions_touch_updated_at
  before update on merchant_exclusions
  for each row execute function public.touch_updated_at();

alter table merchant_exclusions enable row level security;

create policy merchant_exclusions_select on merchant_exclusions for select to authenticated
  using (user_id = (select auth.uid()));
create policy merchant_exclusions_insert on merchant_exclusions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy merchant_exclusions_update on merchant_exclusions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy merchant_exclusions_delete on merchant_exclusions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on merchant_exclusions to authenticated;
