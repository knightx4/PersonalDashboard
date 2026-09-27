-- The day a parcel should arrive (plan #1127).
--
-- Shipping mail usually says when: "Arriving Wednesday, October 1",
-- "Estimated delivery: Oct 3". The lifecycle reader
-- (lib/email/extract/lifecycle.ts) now keeps that day, or the day an "out for
-- delivery" email came, and the agenda's deliveries source shows a parcel on
-- it until the shipment is delivered.
--
-- A date, not an instant: stores give a day, and a day compared through a
-- zone is the mistake orders.return_deadline is a DATE to avoid. Null for a
-- shipment whose mail named no day, including every one read before this.

alter table public.shipments add column if not exists expected_on date;

comment on column public.shipments.expected_on is
  'The day the shipping mail says the parcel should arrive (plan #1127).';
