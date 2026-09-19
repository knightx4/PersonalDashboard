-- The owner reads every note, and can put a name to who filed it.
--
-- The last half of #412. Three accounts sign in to this app and all three can
-- file a bug from the header button, but until now a note was only ever
-- visible to the account that wrote it: migration 0026 restricts
-- `feedback_items` to `user_id = auth.uid()` for every command, and every
-- read in the app filters on the signed-in id on top of that. So a bug filed
-- by anyone else landed in a table nobody would ever look at.
--
-- #419 gives /dev/bugs an Other users section that lists those notes. #413
-- settled that it reads them over the ordinary signed-in, RLS-bound
-- connection -- not the service key, not an env var -- so the widening has to
-- happen here, in a policy, against `public.is_owner()` from 0085.
--
-- Two things, and the second is the one that is easy to get wrong:
--
--   1. A second select policy. Policies for the same command are OR'd, so
--      0026's `feedback_select` keeps standing for everyone and this one adds
--      the owner on top. Select only, deliberately: #414 settled that the
--      Other users section is read-only, so no update, delete or insert policy
--      is widened and the triage actions cannot reach another account's row
--      however they are called.
--
--   2. A way to turn a `user_id` into an address. The row itself carries no
--      email -- a note filed by a non-owner is byte-for-byte the shape of the
--      owner's -- and `auth.users` is not readable by `authenticated` at all,
--      so the section would otherwise list "somebody" three times. That is
--      what `feedback_filer_emails()` is for, and it hands addresses to the
--      owner and to nobody else.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- The owner reads every note
-- ---------------------------------------------------------------------------
--
-- `(select public.is_owner())` rather than a bare call: wrapping it in a
-- scalar subquery is what makes Postgres evaluate it once per statement
-- instead of once per row, which matters on a table read 200 rows at a time.
drop policy if exists feedback_select_owner on feedback_items;
create policy feedback_select_owner on feedback_items for select to authenticated
  using ((select public.is_owner()));

comment on policy feedback_select_owner on feedback_items is
  'The owner (#413) reads every account''s notes, for the Other users section on /dev/bugs. Select only: #414 settled that those rows are read-only, so nothing else about another account''s note is reachable.';

-- ---------------------------------------------------------------------------
-- Who filed it
-- ---------------------------------------------------------------------------
--
-- `{"<user id>": "<address>"}` for every account that has filed a note, and
-- `{}` for everyone who is not the owner. An object rather than a column on
-- the row, because the alternative is a join the signed-in role is not allowed
-- to make; an object rather than a function taking one id, because the section
-- would otherwise make a round trip per row.
--
-- `security definer` for the same reason `app_owner()` is: `auth.users` is
-- closed to `authenticated`. It therefore has to check for itself who is
-- asking -- RLS on `feedback_items` does not constrain what a definer function
-- reads out of `auth.users` -- and the `is_owner()` guard is that check. It is
-- `stable`, so it cannot write, and it exposes no address at all to anyone but
-- the owner.
create or replace function public.feedback_filer_emails()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select public.is_owner())
      then coalesce(
        (
          select jsonb_object_agg(u.id::text, u.email)
            from auth.users u
           where exists (
             select 1 from public.feedback_items f where f.user_id = u.id
           )
        ),
        '{}'::jsonb
      )
    else '{}'::jsonb
  end;
$$;

comment on function public.feedback_filer_emails() is
  'The address behind every account that has filed a note, as {"<user id>": "<email>"} -- for the owner only, and {} for everyone else. Read by lib/feedback/load.ts to name the rows in the Other users section on /dev/bugs (#419).';

-- The lock-down 0007 put on the other definer helpers: callable by nothing
-- until it is granted back, and then only to a signed-in session.
revoke all on function public.feedback_filer_emails() from public, anon, authenticated;
grant execute on function public.feedback_filer_emails() to authenticated;
