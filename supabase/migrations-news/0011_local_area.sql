-- Where you live, for the Local topic.
--
-- Note 552a9407 asked for a Local category, set to NYC for the person who
-- asked. The summariser tags a story Local when it is mainly about this
-- place, so each person names their own; with none set, nothing is Local.
--
-- A table of its own rather than a column on news.addresses: the address is
-- the inbox, and this is a reading preference that has nothing to do with it.
-- One row per person, written from News settings.

set search_path = news, public, extensions;

create table news.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- As the person wrote it: "NYC", "New York City", "Brooklyn". Handed to the
  -- model as written, which reads any of those.
  local_area text,
  updated_at timestamptz not null default now(),

  constraint preferences_local_area_ck
    check (local_area is null or length(btrim(local_area)) between 1 and 80)
);

-- Row level security, the same owner-only policy as issues_all in 0001.
alter table news.preferences enable row level security;

create policy preferences_all on news.preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 0001's grants named the tables that existed then, so this one is granted
-- here, and kept from anonymous visitors the same way.
revoke all on news.preferences from anon;
grant select, insert, update, delete on news.preferences to authenticated, service_role;

notify pgrst, 'reload schema';
