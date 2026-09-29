-- Let the person move charges between their own payments (plans #1210, #1211).
--
-- Merging two payments on the Recurring page moves every charge of the one
-- merged onto the one kept, and moving charges (#1211) does the same for the
-- charges picked. Both run as the person, through RLS, so recurring_charges
-- needs an update policy and a grant on payment_id.
--
-- After a move the payment is worked out again from its charges
-- (resummarisePayment in lib/recurring/store.ts), which writes each charge's
-- previous_amount_cents and the payment's last_charged_on. Those two columns
-- are granted here too; until now only the linker, on the service role,
-- wrote them.
--
-- The update policy only lets a charge be pointed at a payment of the
-- person's own.

drop policy if exists recurring_charges_update on public.recurring_charges;
create policy recurring_charges_update on public.recurring_charges
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recurring_payments p
      where p.id = payment_id and p.user_id = (select auth.uid())
    )
  );

grant update (payment_id, previous_amount_cents) on public.recurring_charges to authenticated;
grant update (last_charged_on) on public.recurring_payments to authenticated;
