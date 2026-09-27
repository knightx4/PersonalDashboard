-- What the person pays for regularly, read from their mail (plan #1125).
--
-- A third workspace reader on the shared inbox, beside the commerce and job
-- linkers (lib/recurring/linker.ts). It claims mail about a subscription or a
-- bill by sender and subject, reads the body of what it claimed with Haiku,
-- and files what it read here. Shopping lists these (plan #1126), and the
-- agenda shows the next date.
--
-- public.recurring_payments   one row per thing paid for: Netflix, the
--                             electricity bill. Found again by payee_key, the
--                             payee's name lowercased with only its letters
--                             and digits, so "Netflix, Inc." and "NETFLIX"
--                             land on the same row.
--   amount_cents, currency    the latest amount, from the most recent charge
--                             or price notice
--   period                    week, month, quarter or year; null when neither
--                             the mail nor the gaps between charges say
--   next_date                 the next charge or due date: the date a renewal
--                             notice or bill names, or the last charge plus
--                             one period
--   status                    'cancelled' after a cancellation email, until a
--                             later charge
--   last_charged_on           the most recent charge or bill date
--
-- public.recurring_charges    one row per email read: a charge, a bill, a
--                             renewal notice, a price change, a trial ending,
--                             a cancellation.
--   occurred_on               the date the charge was made or the email sent
--   due_on                    the date the email names: renewal, due date, or
--                             when a new price starts
--   previous_amount_cents     what it cost before, when this row changed it:
--                             from the notice for a price change, or the
--                             previous charge for a subscription whose charge
--                             differs. Never set by bills, whose amounts vary
--                             every month. A rise is amount > previous.
--
-- public.recurring_messages   the linker's verdict on each message it was
--                             offered, keyed by the core message id, as
--                             public.ingested_messages is for orders. A
--                             claimed message keeps its sender and subject
--                             (core.scrub_unclaimed_messages below).
--
-- core.inbox_catch_ups        how far a workspace has got through the older
--                             mail it asks for with its own Gmail search, so a
--                             workspace added after the mailbox was read still
--                             sees what was already there. One row per mailbox
--                             and workspace; the sync writes it.
--
-- Payments and charges are sources for Goals (lib/inventory/sources.ts); the
-- verdicts and the catch-up rows are bookkeeping.

set search_path = public, extensions;

create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payee text not null,
  payee_key text not null,
  sender_domain text,
  kind text not null default 'subscription',
  amount_cents integer,
  currency text not null default 'USD',
  period text,
  next_date date,
  status text not null default 'active',
  last_charged_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_payments_payee_ck check (length(payee) between 1 and 200),
  constraint recurring_payments_payee_key_ck check (payee_key ~ '^[a-z0-9]{1,120}$'),
  constraint recurring_payments_kind_ck check (kind in ('subscription', 'bill')),
  constraint recurring_payments_amount_ck check (amount_cents is null or amount_cents >= 0),
  constraint recurring_payments_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_payments_period_ck check (
    period is null or period in ('week', 'month', 'quarter', 'year')
  ),
  constraint recurring_payments_status_ck check (status in ('active', 'cancelled'))
);

create unique index if not exists recurring_payments_user_payee_uq
  on public.recurring_payments (user_id, payee_key);

create table if not exists public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payment_id uuid not null references public.recurring_payments (id) on delete cascade,
  message_id uuid references core.ingested_messages (id) on delete set null,
  event text not null,
  amount_cents integer,
  previous_amount_cents integer,
  currency text not null default 'USD',
  period text,
  occurred_on date not null,
  due_on date,
  created_at timestamptz not null default now(),
  constraint recurring_charges_event_ck check (
    event in ('charge', 'bill', 'renewal_notice', 'price_change', 'trial_ending', 'cancelled')
  ),
  constraint recurring_charges_amount_ck check (amount_cents is null or amount_cents >= 0),
  constraint recurring_charges_previous_ck check (
    previous_amount_cents is null or previous_amount_cents >= 0
  ),
  constraint recurring_charges_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_charges_period_ck check (
    period is null or period in ('week', 'month', 'quarter', 'year')
  )
);

create unique index if not exists recurring_charges_message_uq
  on public.recurring_charges (message_id) where message_id is not null;
create index if not exists recurring_charges_payment_idx
  on public.recurring_charges (payment_id, occurred_on desc);
create index if not exists recurring_charges_user_idx
  on public.recurring_charges (user_id);

create table if not exists public.recurring_messages (
  id uuid primary key references core.ingested_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claimed boolean not null,
  parse_status text not null,
  error text,
  charge_id uuid references public.recurring_charges (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_messages_status_ck check (
    parse_status in ('parsed', 'not_recurring', 'skipped', 'failed')
  ),
  constraint recurring_messages_error_ck check (error is null or length(error) <= 500)
);

create index if not exists recurring_messages_user_idx
  on public.recurring_messages (user_id);
create index if not exists recurring_messages_charge_idx
  on public.recurring_messages (charge_id) where charge_id is not null;

-- RLS: every row is its owner's. The linker writes with the service role; the
-- person may correct or remove a payment or a charge from Shopping.

alter table public.recurring_payments enable row level security;
alter table public.recurring_charges enable row level security;
alter table public.recurring_messages enable row level security;

drop policy if exists recurring_payments_select on public.recurring_payments;
create policy recurring_payments_select on public.recurring_payments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists recurring_payments_update on public.recurring_payments;
create policy recurring_payments_update on public.recurring_payments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists recurring_payments_delete on public.recurring_payments;
create policy recurring_payments_delete on public.recurring_payments for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists recurring_charges_select on public.recurring_charges;
create policy recurring_charges_select on public.recurring_charges for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists recurring_charges_delete on public.recurring_charges;
create policy recurring_charges_delete on public.recurring_charges for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists recurring_messages_select on public.recurring_messages;
create policy recurring_messages_select on public.recurring_messages for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.recurring_payments from public, anon, authenticated;
revoke all on public.recurring_charges from public, anon, authenticated;
revoke all on public.recurring_messages from public, anon, authenticated;
grant select, delete on public.recurring_payments to authenticated;
grant update (payee, kind, amount_cents, currency, period, next_date, status, updated_at)
  on public.recurring_payments to authenticated;
grant select, delete on public.recurring_charges to authenticated;
grant select on public.recurring_messages to authenticated;
grant select, insert, update, delete on public.recurring_payments to service_role;
grant select, insert, update, delete on public.recurring_charges to service_role;
grant select, insert, update, delete on public.recurring_messages to service_role;

comment on table public.recurring_payments is
  'Subscriptions and bills found in the mail, one row per payee (plan #1125).';
comment on table public.recurring_charges is
  'Each email about a recurring payment: charge, bill, renewal, price change (plan #1125).';
comment on table public.recurring_messages is
  'The recurring-payments linker''s verdict on each message it was offered (plan #1125).';

-- ---------------------------------------------------------------------------
-- The catch-up cursor, in core beside the sync it belongs to.
-- ---------------------------------------------------------------------------

create table if not exists core.inbox_catch_ups (
  email_account_id uuid not null references core.email_accounts (id) on delete cascade,
  linker text not null,
  query_version integer not null,
  page_token text,
  messages_seen integer not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (email_account_id, linker),
  constraint inbox_catch_ups_linker_ck check (linker ~ '^[a-z][a-z0-9_-]{0,40}$')
);

alter table core.inbox_catch_ups enable row level security;

drop policy if exists inbox_catch_ups_select on core.inbox_catch_ups;
create policy inbox_catch_ups_select on core.inbox_catch_ups for select to authenticated
  using (
    exists (
      select 1 from core.email_accounts a
      where a.id = inbox_catch_ups.email_account_id and a.user_id = (select auth.uid())
    )
  );

revoke all on core.inbox_catch_ups from public, anon, authenticated;
grant select on core.inbox_catch_ups to authenticated;
grant select, insert, update, delete on core.inbox_catch_ups to service_role;

comment on table core.inbox_catch_ups is
  'How far each workspace has read the older mail its own Gmail search finds (plan #1125).';

-- ---------------------------------------------------------------------------
-- A message the recurring linker claimed keeps its sender and subject.
--
-- Same function as 0029 with one more "not claimed" clause. It does not wait
-- for a recurring verdict: the linker runs in the same fan-out as the other
-- two, before the scrub, so new mail always has one, and waiting would keep
-- every message read before this migration unscrubbed for good.
-- ---------------------------------------------------------------------------

create or replace function core.scrub_unclaimed_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scrubbed integer;
begin
  with unclaimed as (
    select m.id
    from core.ingested_messages m
    where m.scrubbed_at is null
      and exists (select 1 from public.ingested_messages c where c.id = m.id)
      and exists (select 1 from job_search.ingested_messages j where j.id = m.id)
      and not exists (
        select 1 from public.ingested_messages c
        where c.id = m.id
          and c.classification is distinct from 'not_relevant'::public.message_classification
      )
      and not exists (
        select 1 from job_search.ingested_messages j
        where j.id = m.id
          and j.classification is distinct from 'not_relevant'::job_search.message_classification
      )
      and not exists (
        select 1 from public.recurring_messages r
        where r.id = m.id and r.claimed
      )
  )
  update core.ingested_messages m
  set subject = null,
      from_address = null,
      reply_to_address = null,
      thread_id = null,
      scrubbed_at = now()
  from unclaimed u
  where m.id = u.id;

  get diagnostics scrubbed = row_count;
  return scrubbed;
end;
$$;

revoke execute on function core.scrub_unclaimed_messages() from public, anon, authenticated;
grant execute on function core.scrub_unclaimed_messages() to service_role;
