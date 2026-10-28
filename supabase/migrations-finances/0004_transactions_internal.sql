-- Marking money that only moved between the person's own accounts
-- (plan #2593.7).
--
-- Paying a card from checking shows up twice: once as money out of checking
-- and once as money into the card. The purchases on the card are already the
-- spending, so the payment is not spending a second time. The same holds for
-- a transfer from checking to savings.
--
-- internal_kind says which of the two a transaction is, and internal_pair_id
-- points at the other half when both halves are on accounts the person holds.
-- A half with no partner (a card payment to a card that is not linked yet,
-- marked by its category) has the kind and no pair.
--
-- Spending works these out as it reads (lib/finances/spending/internal.ts),
-- so the page is right before anything is written here. The columns hold
-- what the matcher found once it is saved, and a correction the person makes,
-- so Dash and SQL read the same answer the page shows.

set search_path = finances, public, extensions;

alter table finances.transactions
  add column internal_kind text,
  add column internal_pair_id uuid;

alter table finances.transactions
  add constraint transactions_internal_kind_ck
    check (internal_kind is null or internal_kind in ('card_payment', 'transfer')),
  add constraint transactions_internal_pair_self_ck
    check (internal_pair_id is null or internal_pair_id <> id),
  add constraint transactions_internal_pair_kind_ck
    check (internal_pair_id is null or internal_kind is not null),
  -- The partner is checked against the owner, as every child row is here.
  add constraint transactions_id_user_key unique (id, user_id),
  add constraint transactions_internal_pair_fk foreign key (internal_pair_id, user_id)
    references finances.transactions (id, user_id) on delete set null (internal_pair_id);

create index transactions_internal_pair_idx on finances.transactions (internal_pair_id)
  where internal_pair_id is not null;
