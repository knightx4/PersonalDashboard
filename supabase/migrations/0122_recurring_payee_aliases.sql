-- Corrected payee names, remembered for future mail (plan #1208).
--
-- The Recurring page lets the person correct what the mail reader got wrong
-- about a payment: rename it, merge two rows that are the same thing, move
-- charges between them (feature #1193). A correction has to hold when the
-- next email about that payee arrives, so the name the mail gives is kept
-- here against the payment the person chose.
--
-- public.recurring_payee_aliases   one row per payee key that files onto a
--                                  payment other than the one with that key.
--   payee_key     the key the mail gives, in the same form as
--                 recurring_payments.payee_key (payeeKey in
--                 lib/recurring/extraction.ts)
--   payment_id    the payment a reading with that key is filed on
--
-- lib/recurring/store.ts (ensurePayment) looks a reading's key up here before
-- recurring_payments. A merge (plan #1210) writes the merged payment's key
-- here and re-points the aliases that named it; deleting a payment removes
-- the aliases that name it.
--
-- recurring_payments.status gains 'ignored': a payment the person left out of
-- the monthly total (plan #1213). The store keeps it when new charges are
-- filed, so the next statement does not put it back.
--
-- The aliases are bookkeeping, not a source for Goals (lib/inventory/sources.ts).

create table if not exists public.recurring_payee_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payee_key text not null,
  payment_id uuid not null references public.recurring_payments (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint recurring_payee_aliases_key_ck check (payee_key ~ '^[a-z0-9]{1,120}$')
);

create unique index if not exists recurring_payee_aliases_user_key_uq
  on public.recurring_payee_aliases (user_id, payee_key);
create index if not exists recurring_payee_aliases_payment_idx
  on public.recurring_payee_aliases (payment_id);

-- RLS: owner-only. The linker reads with the service role; the page's server
-- actions write as the person, and may only point an alias at a payment of
-- their own.

alter table public.recurring_payee_aliases enable row level security;

drop policy if exists recurring_payee_aliases_select on public.recurring_payee_aliases;
create policy recurring_payee_aliases_select on public.recurring_payee_aliases
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists recurring_payee_aliases_insert on public.recurring_payee_aliases;
create policy recurring_payee_aliases_insert on public.recurring_payee_aliases
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recurring_payments p
      where p.id = payment_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists recurring_payee_aliases_update on public.recurring_payee_aliases;
create policy recurring_payee_aliases_update on public.recurring_payee_aliases
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recurring_payments p
      where p.id = payment_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists recurring_payee_aliases_delete on public.recurring_payee_aliases;
create policy recurring_payee_aliases_delete on public.recurring_payee_aliases
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.recurring_payee_aliases from public, anon, authenticated;
grant select, insert, delete on public.recurring_payee_aliases to authenticated;
grant update (payment_id) on public.recurring_payee_aliases to authenticated;
grant select, insert, update, delete on public.recurring_payee_aliases to service_role;

comment on table public.recurring_payee_aliases is
  'Payee names from the mail that file onto a payment the person chose (plan #1208).';

-- 'ignored': left out of the monthly total by the person (plan #1213).
alter table public.recurring_payments
  drop constraint if exists recurring_payments_status_ck;
alter table public.recurring_payments
  add constraint recurring_payments_status_ck
  check (status in ('active', 'cancelled', 'ignored'));
