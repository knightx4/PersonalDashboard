-- Whose shopping is this?
--
-- One account, two people. The account is not shared in the auth sense -- there
-- is still one login and one user_id -- but two mailboxes now hang off it and
-- the orders from each belong to a different person. Without this the two sets
-- of shopping pile into one list where nothing distinguishes them, and every
-- spend figure silently answers a question nobody asked.
--
-- Deliberately NOT a households/membership model. That is the open question in
-- the README and it is a genuinely large change: a second user_id, a join
-- table, and every RLS policy in three schemas rewritten to go through it. This
-- is the smaller true thing -- attribution within one account -- and it is what
-- was actually asked for. If a real second login is ever wanted, `people` is
-- the row a future membership would point at rather than something to undo.
--
-- People live in `core` because a mailbox lives in core: "whose inbox is this"
-- is the fact that drives everything downstream, and core is where the mailbox
-- is. The commerce tables reference it across schemas, which Postgres is
-- perfectly happy with.

-- ---------------------------------------------------------------------------
-- core.people
-- ---------------------------------------------------------------------------
create table if not exists core.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- A token name from globals.css, not a hex value: the palette is defined in
  -- one place and a colour picked here has to survive a theme change.
  colour text not null default 'brand',
  -- The person a manual order is attributed to unless you say otherwise. The
  -- partial unique index below allows exactly one per account.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint people_name_not_blank_ck check (btrim(name) <> ''),
  constraint people_name_length_ck check (char_length(name) <= 60),
  constraint people_colour_ck check (
    colour in ('brand', 'orange', 'pink', 'green', 'purple', 'slate')
  )
);

create index if not exists people_user_idx on core.people (user_id);
-- Case-insensitive, because "Emma" and "emma" are one person and a duplicate
-- here quietly splits somebody's spending in two.
create unique index if not exists people_user_name_key
  on core.people (user_id, lower(btrim(name)));
create unique index if not exists people_one_default_per_user
  on core.people (user_id) where is_default;

alter table core.people enable row level security;

-- Matches the existing core policies, including the (select auth.uid()) form:
-- bare auth.uid() is re-evaluated per row.
create policy people_select on core.people for select to authenticated
  using (user_id = (select auth.uid()));
create policy people_insert on core.people for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy people_update on core.people for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy people_delete on core.people for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on core.people to authenticated;
grant all on core.people to service_role;

-- ---------------------------------------------------------------------------
-- Attribution
--
-- `on delete set null` everywhere rather than cascade. Removing a person must
-- never remove their shopping: the orders happened, and an unlabelled order is
-- a far better outcome than a deleted one.
-- ---------------------------------------------------------------------------
alter table core.email_accounts
  add column if not exists person_id uuid references core.people (id) on delete set null;

alter table public.orders
  add column if not exists person_id uuid references core.people (id) on delete set null;

-- Denormalised onto the item for the same reason name and fingerprint already
-- are: an item added by hand has no order to join through, and the inventory
-- list has to filter by person for those too.
alter table public.inventory_items
  add column if not exists person_id uuid references core.people (id) on delete set null;

-- Every foreign key gets an index; Postgres does not add one, and without it
-- both the filter and the ON DELETE SET NULL scan the whole table.
create index if not exists email_accounts_person_idx on core.email_accounts (person_id);
-- Composite and in this order because the query is always "this user's orders,
-- this person, newest first" -- user_id leads since it is in every query.
create index if not exists orders_person_idx on public.orders (user_id, person_id, order_date desc);
create index if not exists inventory_items_person_idx on public.inventory_items (user_id, person_id);

comment on table core.people is
  'A person whose shopping this account tracks. One login, several people: mailboxes and orders are attributed to one of these.';
comment on column public.orders.person_id is
  'Whose order this is. Set from the mailbox it was imported from, or chosen on manual entry. Null means unattributed, which is normal for data that predates the feature.';

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Everything already stored predates the second mailbox, so it belongs to
-- whoever owns the mailbox it came from. Without this the feature ships
-- looking broken: filters that match nothing and a list of unlabelled rows.
--
-- One person per connected mailbox, named from the address, because that is
-- the only name the database actually knows. It is meant to be renamed in
-- settings -- which is why the name is not treated as an identifier anywhere.
-- ---------------------------------------------------------------------------
insert into core.people (user_id, name, is_default, colour)
select
  ea.user_id,
  -- Local part, tidied: "selvey.knight4" -> "Selvey Knight4". Ugly for some
  -- addresses and trivially renameable, which beats inventing a name.
  initcap(regexp_replace(split_part(ea.email_address, '@', 1), '[._+-]+', ' ', 'g')),
  -- The oldest mailbox on the account is the account owner's, and becomes the
  -- default that manual orders are attributed to.
  ea.created_at = min(ea.created_at) over (partition by ea.user_id),
  'brand'
from core.email_accounts ea
on conflict (user_id, lower(btrim(name))) do nothing;

update core.email_accounts ea
   set person_id = p.id,
       updated_at = now()
  from core.people p
 where ea.person_id is null
   and p.user_id = ea.user_id
   and lower(btrim(p.name)) = lower(
     initcap(regexp_replace(split_part(ea.email_address, '@', 1), '[._+-]+', ' ', 'g'))
   );

-- Orders reach their mailbox through the message that created them. A manual
-- order has no message and stays null until the owner says otherwise -- better
-- than guessing, since a manual order is as likely to be either person's.
-- Two hops, because the split put them in different schemas: the verdict
-- ("this message produced that order") is the commerce side's and is keyed by
-- the core row's id, while the mailbox it arrived in is core's.
update public.orders o
   set person_id = ea.person_id,
       updated_at = now()
  from public.ingested_messages im
  join core.ingested_messages cm on cm.id = im.id
  join core.email_accounts ea on ea.id = cm.email_account_id
 where im.resulting_order_id = o.id
   and o.person_id is null
   and ea.person_id is not null;

-- Inventory follows its order.
update public.inventory_items ii
   set person_id = o.person_id,
       updated_at = now()
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
 where ii.order_item_id = oi.id
   and ii.person_id is null
   and o.person_id is not null;

-- ---------------------------------------------------------------------------
-- Re-attributing a mailbox
--
-- Saying "this inbox is Emma's" has to apply to what it already imported, not
-- only to what arrives next. The usual order of events is: connect the second
-- mailbox, let it sync, then set up the people -- and without this every order
-- from that sync stays unattributed and the feature looks broken on the day it
-- is switched on.
--
-- The mailbox is treated as the authority for its own imported orders, so this
-- overwrites rather than only filling blanks: correcting a mailbox assigned to
-- the wrong person has to actually correct the orders. Manual orders have no
-- source message and are never touched by this.
--
-- Two statements in one function because PostgREST cannot express either, and
-- doing it client-side would be a round trip per order.
-- ---------------------------------------------------------------------------
create or replace function core.attribute_mailbox(p_account_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_person uuid;
  v_owner uuid;
  v_orders integer;
begin
  -- RLS restricts this select to the caller's own mailboxes, so a foreign
  -- account id finds nothing and the function does nothing.
  select person_id, user_id into v_person, v_owner
    from core.email_accounts
   where id = p_account_id;

  if v_owner is null then
    return 0;
  end if;

  update public.orders o
     set person_id = v_person,
         updated_at = now()
    from public.ingested_messages im
    join core.ingested_messages cm on cm.id = im.id
   where im.resulting_order_id = o.id
     and cm.email_account_id = p_account_id
     and o.user_id = v_owner
     and o.person_id is distinct from v_person;

  get diagnostics v_orders = row_count;

  update public.inventory_items ii
     set person_id = o.person_id,
         updated_at = now()
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where ii.order_item_id = oi.id
     and o.user_id = v_owner
     and ii.person_id is distinct from o.person_id;

  return v_orders;
end;
$$;

revoke all on function core.attribute_mailbox(uuid) from public;
grant execute on function core.attribute_mailbox(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Whose mailbox is this, for a client bound to `public`
--
-- The commerce side's Supabase client carries `db: { schema: 'public' }`, so
-- it cannot select from core.email_accounts at all -- and PostgREST will not
-- embed across schemas either. The sync needs exactly one fact from there:
-- which person owns the mailbox it is importing from. A two-column view is the
-- whole of it.
--
-- security_invoker, so the underlying RLS on core.email_accounts still decides
-- what is visible; this exposes a column, not a way around a policy.
-- ---------------------------------------------------------------------------
create or replace view public.email_account_people with (security_invoker = true) as
select
  ea.id as email_account_id,
  ea.user_id,
  ea.person_id
from core.email_accounts ea;

grant select on public.email_account_people to authenticated, service_role;
