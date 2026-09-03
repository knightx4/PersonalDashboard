-- Take back the grants nobody asked for.
--
-- 0040 and 0041 say, in as many words, that anon gets no policy and no grant
-- on any of these eight tables -- anonymous access is share_page() and
-- share_respond() and nothing else. That is true of a plain Postgres, which is
-- what the test database is, so tests/rls-share.test.ts passes there.
--
-- It was not true of the deployed project. Supabase's default privileges hand
-- `anon` and `authenticated` SELECT/INSERT/UPDATE/DELETE on every new table in
-- `public` so the Data API can reach it, and a CREATE TABLE inherits that
-- whether or not the migration mentions anon. So these tables landed in
-- production with anon privileges the migration that created them never
-- granted -- as did `game_details` and `item_tags` before them.
--
-- Nothing leaked: RLS is enabled and every policy is `to authenticated`, so
-- anon selected zero rows and could insert none. The problem is that the
-- privilege was doing no work and standing ready to do the wrong work. The
-- protection was resting entirely on the policies, and one policy written
-- `for insert to public` -- or simply written without a `TO` clause -- would
-- have turned a dormant grant into an anonymous write path on someone's
-- shared form.
--
-- Defence in depth means the grant and the policy both have to be wrong before
-- anything is reachable. This restores that, and is written to be safe to run
-- anywhere: revoking a privilege that was never granted is a no-op.

set search_path = public, extensions;

revoke all on table share_links from anon;
revoke all on table share_link_tokens from anon;
revoke all on table share_link_items from anon;
revoke all on table share_link_responses from anon;
revoke all on table share_link_events from anon;
revoke all on table item_families from anon;
revoke all on table inventory_item_families from anon;
revoke all on table inventory_item_tags from anon;

-- The two functions are unaffected: they are `security definer`, so they run
-- as their owner and never needed a table grant on the caller's behalf. This
-- is exactly why the anonymous surface was built as two functions rather than
-- as a policy -- revoking every table privilege anon has changes nothing about
-- what the shared form can do.
