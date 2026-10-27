-- Which account owns the app, as a row rather than as an address in a migration.
--
-- 0085 named the owner by writing their email address into
-- public.owner_email(), so the repository carried one person's address and a
-- new install was owned by an account it did not have. The owner is now the
-- one row of core.app_settings, and owner_email() reads it, so app_owner(),
-- is_owner(), core.dev_owner_id() and everything written against them keep
-- working unchanged.
--
-- The row is filled from what owner_email() answered before this migration,
-- when that address belongs to an account here. On the live database that is
-- the owner it already had; on a new install there is no such account, the
-- owner is empty, and the Dev workspace stays shut until it is set:
--
--   update core.app_settings
--      set owner_user_id = (select id from auth.users where email = 'you@example.com');
--
-- (docs/SETUP.md). Only the definer functions read the table; nothing outside
-- the database reaches it.

create table if not exists core.app_settings (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table core.app_settings is
  'Settings for the whole install, one row. owner_user_id is the account the Dev workspace and the owner-only routines belong to; null until it is set (docs/SETUP.md).';

alter table core.app_settings enable row level security;
revoke all on core.app_settings from public, anon, authenticated;

insert into core.app_settings (singleton, owner_user_id)
select true, (select u.id from auth.users u where lower(u.email) = public.owner_email() limit 1)
on conflict (singleton) do nothing;

create or replace function public.owner_email()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(u.email)
    from core.app_settings s
    join auth.users u on u.id = s.owner_user_id
   limit 1;
$$;

comment on function public.owner_email() is
  'The address of the account the Dev workspace belongs to, read from core.app_settings (0284). Every other owner check reads this rather than naming an account.';

revoke all on function public.owner_email() from public, anon, authenticated;
