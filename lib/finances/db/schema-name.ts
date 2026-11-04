/**
 * The Postgres schema that holds the Finances workspace (plan #2593): the
 * person's bank, card, brokerage and loan accounts, their balances,
 * transactions and holdings.
 *
 * Three things have to agree, as for every other schema:
 *
 *   1. The migrations in supabase/migrations-finances create everything here.
 *   2. Every supabase-js client that touches it passes
 *      `db: { schema: FINANCES_SCHEMA }`.
 *   3. The schema is exposed to PostgREST, which migrations-finances/0002 does.
 *
 * finances.links.access_token is not readable by the signed-in person's
 * client: read and write links through the service role on the server.
 */
export const FINANCES_SCHEMA = 'finances';

/** A Supabase client bound to the finances schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FinancesSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof FINANCES_SCHEMA>;
