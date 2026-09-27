-- ---------------------------------------------------------------------------
-- 0012 -- bills and renewals can be put off and dismissed on the agenda.
--
-- A bill due or a subscription renewing is read from public.recurring_payments
-- at query time (lib/todo/agenda/sources/bills.ts), and like a return deadline
-- it is a date rather than a task: paying happens elsewhere. "Later" and "Not
-- this one" are about this list only, so they go in the dismissal overlay.
--
-- The key is `bills:<payment id>:<due date>`, so dismissing one month's bill
-- leaves the next month's to show.
-- ---------------------------------------------------------------------------

alter type todo.foreign_source add value if not exists 'recurring_payment';
