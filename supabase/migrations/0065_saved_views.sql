-- An arrangement of a list, saved under a name.
--
-- A view is a URL: the filters, the search, the sort, the grouping and the
-- columns a list is currently drawing all ride in the query string, which is
-- what makes one sendable to somebody. What it is not is findable again. This
-- is the name and the query string beside it.
--
-- `core` rather than beside any one list, and on the account rather than in a
-- cookie -- that is #335. Everything else this app remembers about you is on
-- the account, a view worth naming is worth having on the phone too, and the
-- default-view half of the idea cannot be built at all without somewhere
-- durable to put it.
--
-- `list` is the page a view belongs to, as its pathname. An orders view has no
-- meaning on the roles table -- the parameters it carries name sorts and
-- columns that list does not have -- so the list is part of the key rather
-- than a label on the row.

set search_path = core, public, extensions;

create table core.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The pathname of the list, e.g. '/shopping/orders'. Not an enum: a new list
  -- gaining display options should not need a migration to be savable.
  list text not null,
  name text not null,
  -- The query string as it stood, without the leading '?'. Everything the page
  -- reads: the filters and the search as well as the arrangement, because a
  -- view that reopened the sort and lost the filter would be the wrong rows in
  -- the right order.
  query text not null default '',

  -- The one this list opens on when nothing is asked for. At most one per list,
  -- which is the partial unique index below rather than a rule the application
  -- promises.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint saved_views_list_ck check (list <> ''),
  constraint saved_views_name_ck check (name <> '')
);

-- Saving again under a name you already used replaces that view rather than
-- making a second one with the same name, which is what the upsert in
-- lib/saved-views.ts targets. Case-insensitive, because "Recent" and "recent"
-- are one name to the person typing them.
create unique index saved_views_user_list_name_uq
  on core.saved_views (user_id, list, lower(name));

-- One default per list. A second one is refused by the database rather than by
-- whichever write happened to run last.
create unique index saved_views_one_default_uq
  on core.saved_views (user_id, list)
  where is_default;

create index saved_views_user_list_idx on core.saved_views (user_id, list, name);

create trigger saved_views_touch_updated_at
  before update on core.saved_views
  for each row execute function core.touch_updated_at();

alter table core.saved_views enable row level security;

create policy saved_views_all on core.saved_views for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.saved_views from anon;
grant select, insert, update, delete on core.saved_views to authenticated, service_role;
