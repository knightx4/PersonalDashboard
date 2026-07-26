-- Row level security.
--
-- RLS is the entire multi-tenancy story. Every table holding user data has it
-- enabled -- not most, every one. The cross-user isolation test in
-- tests/rls.test.ts loops over the table list and fails automatically if a new
-- table shows up without a policy.
--
-- Child tables without their own user_id reach the owner through their parent.
-- Every such foreign key is indexed in 0002, or these get slow fast.

set search_path = public, extensions;

-- Nothing is readable by anonymous visitors.
revoke all on all tables in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table profiles           enable row level security;
alter table categories         enable row level security;
alter table merchants          enable row level security;
alter table email_accounts     enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table inventory_items    enable row level security;
alter table item_uses          enable row level security;
alter table shipments          enable row level security;
alter table returns            enable row level security;
alter table saved_items        enable row level security;
alter table price_checks       enable row level security;
alter table ingested_messages  enable row level security;
alter table sync_jobs          enable row level security;

-- ---------------------------------------------------------------------------
-- profiles -- keyed to auth.users.id rather than a user_id column
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No insert policy: profiles are created by the on_auth_user_created trigger.
-- No delete policy: profiles die with the auth.users row.

-- ---------------------------------------------------------------------------
-- categories -- the one table where the standard template does NOT apply.
-- Rows with a null user_id are system categories and must be visible to
-- everyone, but editable by no one.
-- ---------------------------------------------------------------------------
create policy categories_select on categories for select to authenticated
  using (user_id = (select auth.uid()) or user_id is null);
create policy categories_insert on categories for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy categories_update on categories for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy categories_delete on categories for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- merchants -- global rows are shared and read-only; auto-discovered rows are
-- scoped to their creator so one user's parser cannot write a row the whole
-- tenant base can see. Promotion to global is an offline job run as postgres.
-- ---------------------------------------------------------------------------
create policy merchants_select on merchants for select to authenticated
  using (is_global or created_by_user_id = (select auth.uid()));
create policy merchants_insert on merchants for insert to authenticated
  with check (not is_global and created_by_user_id = (select auth.uid()));
create policy merchants_update on merchants for update to authenticated
  using (not is_global and created_by_user_id = (select auth.uid()))
  with check (not is_global and created_by_user_id = (select auth.uid()));
create policy merchants_delete on merchants for delete to authenticated
  using (not is_global and created_by_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Standard owner policies: user_id = auth.uid()
-- ---------------------------------------------------------------------------
create policy email_accounts_select on email_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy email_accounts_insert on email_accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy email_accounts_update on email_accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy email_accounts_delete on email_accounts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy orders_select on orders for select to authenticated
  using (user_id = (select auth.uid()));
create policy orders_insert on orders for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy orders_update on orders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy orders_delete on orders for delete to authenticated
  using (user_id = (select auth.uid()));

create policy inventory_items_select on inventory_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy inventory_items_insert on inventory_items for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy inventory_items_update on inventory_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy inventory_items_delete on inventory_items for delete to authenticated
  using (user_id = (select auth.uid()));

create policy returns_select on returns for select to authenticated
  using (user_id = (select auth.uid()));
create policy returns_insert on returns for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy returns_update on returns for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy returns_delete on returns for delete to authenticated
  using (user_id = (select auth.uid()));

create policy saved_items_select on saved_items for select to authenticated
  using (user_id = (select auth.uid()));
create policy saved_items_insert on saved_items for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy saved_items_update on saved_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy saved_items_delete on saved_items for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Child tables -- ownership through the parent
-- ---------------------------------------------------------------------------
create policy order_items_all on order_items for all to authenticated
  using (exists (
    select 1 from orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  ));

create policy shipments_all on shipments for all to authenticated
  using (exists (
    select 1 from orders o
    where o.id = shipments.order_id and o.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from orders o
    where o.id = shipments.order_id and o.user_id = (select auth.uid())
  ));

create policy item_uses_all on item_uses for all to authenticated
  using (exists (
    select 1 from inventory_items ii
    where ii.id = item_uses.inventory_item_id and ii.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from inventory_items ii
    where ii.id = item_uses.inventory_item_id and ii.user_id = (select auth.uid())
  ));

create policy price_checks_all on price_checks for all to authenticated
  using (exists (
    select 1 from saved_items si
    where si.id = price_checks.saved_item_id and si.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from saved_items si
    where si.id = price_checks.saved_item_id and si.user_id = (select auth.uid())
  ));

create policy ingested_messages_all on ingested_messages for all to authenticated
  using (exists (
    select 1 from email_accounts ea
    where ea.id = ingested_messages.email_account_id
      and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from email_accounts ea
    where ea.id = ingested_messages.email_account_id
      and ea.user_id = (select auth.uid())
  ));

create policy sync_jobs_all on sync_jobs for all to authenticated
  using (exists (
    select 1 from email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from email_accounts ea
    where ea.id = sync_jobs.email_account_id and ea.user_id = (select auth.uid())
  ));
