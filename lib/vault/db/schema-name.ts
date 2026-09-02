/**
 * The Postgres schema that holds the vault.
 *
 * A fourth schema, for the same reason there is a third: the notes are not a
 * commerce fact or a recruiting fact, and they do not arrive on the shared
 * mailbox sync either, so they belong to neither workspace and not to `core`.
 *
 * Three things have to agree, as with `job_search` and `core`:
 *
 *   1. The migrations create everything in this schema.
 *   2. Every supabase-js client that touches the vault passes
 *      `db: { schema: VAULT_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard, alongside `public`, `job_search` and `core`.
 */
export const VAULT_SCHEMA = 'vault';

/**
 * A Supabase client bound to the vault schema.
 *
 * The schema rides in the client's type, so a function typed against this
 * cannot be handed a client that would silently read a workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VaultSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof VAULT_SCHEMA>;
