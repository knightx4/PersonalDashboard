-- The daily Plaid sync (plan #2593.4): card details, and the record of a
-- link that keeps failing.

set search_path = finances, public, extensions;

-- ---------------------------------------------------------------------------
-- Card and loan details from /liabilities/get.
--
-- 0001 kept the rate, the minimum payment and the due date for loans only.
-- A card has all three as well, plus a statement: the balance on the last
-- statement and the day it was issued. The rate on a card is its purchase
-- APR.
-- ---------------------------------------------------------------------------
alter table finances.accounts
  add column statement_balance_cents bigint,
  add column last_statement_on date;

alter table finances.accounts drop constraint accounts_loan_fields_ck;

alter table finances.accounts add constraint accounts_loan_fields_ck check (
  kind in ('loan', 'credit_card')
  or num_nonnulls(interest_rate, minimum_payment_cents, next_payment_due_on,
                  statement_balance_cents, last_statement_on) = 0
);

-- ---------------------------------------------------------------------------
-- A link that fails to sync.
--
-- failing_since is the day of the first failed sync since the last one that
-- worked, and a sync that works clears it. On the third day of failing the
-- sync files a Dev note and sets failure_noted_on, so the note is written
-- once a streak.
-- ---------------------------------------------------------------------------
alter table finances.links
  add column failing_since date,
  add column failure_noted_on date;

grant select (failing_since, failure_noted_on) on finances.links to authenticated;
