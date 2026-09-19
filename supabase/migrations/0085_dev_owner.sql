-- Which account is the owner's, named once, in the database.
--
-- Three accounts sign in to this app and until now nothing anywhere could tell
-- them apart: every page under /dev, every server action behind those pages
-- and the module list treat any signed-in account the same. #413 settled where
-- that fact should live -- here, in a migration, and not in a Vercel
-- environment variable -- for two reasons. The database is where every other
-- ownership question in this app is answered, and the one screen that has to
-- read another account's rows (the Other users section on /dev/bugs, #419) can
-- then do it over the same signed-in connection everything else uses, with no
-- service key anywhere near a page.
--
-- Three functions, one fact:
--
--   owner_email()  -- the account, named. The only place the address appears.
--   app_owner()    -- who that is, for the app: the user id and the address.
--   is_owner()     -- whether the caller is that account, for RLS.
--
-- `owner_email()` is not reachable over PostgREST: the other two are
-- `security definer`, so they read it as the function owner, and nothing
-- outside the database needs the address on its own. `app_owner()` and
-- `is_owner()` are `security definer` because `auth.users` is not readable by
-- `authenticated` at all -- neither takes an argument, neither exposes a table,
-- and both are the whole of what they answer. Both are `stable`, so neither
-- can write.
--
-- Changing which account is the owner is another migration and a deploy. That
-- is the cost #413 accepted, against an address that is not going to change.
--
-- Nothing reads any of this yet. The helper in lib/dev/owner.ts (#415) calls
-- `app_owner()`; #416 to #418 put that helper in front of the dev pages, the
-- dev server actions and the header button; #419 adds the policy on
-- `feedback_items` that lets the owner read every note, and `is_owner()` is
-- what that policy is written against.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- The account
-- ---------------------------------------------------------------------------
create or replace function public.owner_email()
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select 'selveyknight4@gmail.com'::text;
$$;

comment on function public.owner_email() is
  'The account the Dev workspace belongs to, named once (#413). Every other owner check reads this rather than spelling the address again.';

-- ---------------------------------------------------------------------------
-- Who that is, for the app
-- ---------------------------------------------------------------------------
--
-- Returns null when no account with that address exists, which is what a local
-- database seeded with somebody else's accounts looks like. The helper reads
-- that as "not the owner" and the Dev workspace stays shut, which is the safe
-- direction to fail in.
create or replace function public.app_owner()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('userId', u.id, 'email', u.email)
    from auth.users u
   where lower(u.email) = public.owner_email()
   limit 1;
$$;

comment on function public.app_owner() is
  'The owner as the app reads it: {"userId", "email"}, or null when no such account exists. Read by lib/dev/owner.ts, which compares the user id against the signed-in session.';

-- ---------------------------------------------------------------------------
-- Whether the caller is that account, for RLS
-- ---------------------------------------------------------------------------
--
-- Matches on the user id rather than on the email claim in the token, because
-- the id is the claim that is always there and is what every policy in this
-- app already keys on. Signed out, `auth.uid()` is null and this is false.
--
-- Call it as `(select public.is_owner())` inside a policy so Postgres
-- evaluates it once for the statement rather than once per row.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = (select auth.uid())
       and lower(u.email) = public.owner_email()
  );
$$;

comment on function public.is_owner() is
  'Whether the signed-in account is the owner (#413). Written for RLS: use it as (select public.is_owner()) in a policy.';

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
--
-- The same lock-down 0007 put on the other definer helpers: nothing is
-- callable by default, and only what the app calls is granted back.
-- `owner_email()` is granted to nobody -- the two functions above read it as
-- their owner, and an address nobody outside the database needs is an address
-- nobody outside the database gets.
revoke all on function public.owner_email() from public, anon, authenticated;
revoke all on function public.app_owner() from public, anon, authenticated;
revoke all on function public.is_owner() from public, anon, authenticated;

grant execute on function public.app_owner() to authenticated;
grant execute on function public.is_owner() to authenticated;
