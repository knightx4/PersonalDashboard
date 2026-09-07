-- Say out loud who may touch `ideas`, which 0048 left to the defaults.
--
-- Two separate things, and neither is an outage.
--
-- THE GRANT. Row level security decides WHICH rows a role may see; a table
-- grant decides whether it may touch the table at all, and a table with
-- perfect policies and no grant fails every query with "permission denied"
-- before a policy is consulted. On a hosted Supabase project this never
-- surfaced: the project carries default privileges on `public` that grant
-- every newly created table to authenticated, so `ideas` worked in production
-- from the moment it was created.
--
-- The local test database has no such defaults, which is the whole point of
-- scripts/db-reset.sh -- it rebuilds from the migrations alone, so anything
-- that only works because of a setting outside version control fails there.
-- tests/rls.test.ts failed on `ideas` for exactly that reason. Adding the
-- grant explicitly is what every other table in this schema does, and it makes
-- the migration true on its own rather than true on Supabase.
--
-- THE REVOKE. Those same default privileges also grant new tables to `anon`.
-- 0004 revokes anon across the schema, but a `grant ... on all tables`
-- statement applies to the tables that exist when it runs -- it cannot reach
-- forward -- so every table added since has quietly arrived with anon
-- privileges again. 0044 did this by hand for the share tables for the same
-- reason.
--
-- Nothing was exposed: `ideas` has RLS on and its policies name `authenticated`
-- only, so an anonymous request matches no policy and reads zero rows. This is
-- the second lock rather than the first. It matters because the first one is
-- one careless `for all to public` away from being gone, and because a table
-- an anonymous role can address is one somebody has to think about every time.

set search_path = public, extensions;

grant select, insert, update, delete on ideas to authenticated;

revoke all on table ideas from anon;
