-- Let the person create a payment of their own from the Recurring page
-- (plan #1211).
--
-- Moving charges out of a payment that holds several things (the "Apple" row,
-- whose receipts are for more than one subscription) can move them to a new
-- payment the person names. That runs as the person, through RLS, so
-- recurring_payments needs an insert policy and a grant on the columns the
-- page writes. Everything else on the row (amount, period, next date, status)
-- is worked out from the charges afterwards, through the update grant
-- migrations 0115 and 0123 already give.
--
-- The policy only lets a person create a payment that is theirs.

drop policy if exists recurring_payments_insert on public.recurring_payments;
create policy recurring_payments_insert on public.recurring_payments
  for insert to authenticated
  with check (user_id = (select auth.uid()));

grant insert (user_id, payee, payee_key, kind, sender_domain, currency)
  on public.recurring_payments to authenticated;
