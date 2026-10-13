/**
 * The Postgres schema that holds the You workspace (plan #1991): what is true
 * about the person, such as their personality results and the places they
 * have lived.
 *
 * Three things have to agree, as for every other schema:
 *
 *   1. The migrations in supabase/migrations-you create everything here.
 *   2. Every supabase-js client that touches it passes
 *      `db: { schema: YOU_SCHEMA }`.
 *   3. The schema is exposed to PostgREST, which migrations-you/0002 does.
 */
export const YOU_SCHEMA = 'you';

/**
 * A Supabase client bound to the you schema, so a function typed against it
 * cannot be handed a client that reads another workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YouSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof YOU_SCHEMA>;
