/**
 * The Postgres schema that holds the learn module.
 *
 * A fifth schema, on the same reasoning as the other four: a reading queue is
 * not a commerce fact or a recruiting fact, it does not arrive on the shared
 * mailbox sync, and it outlives the vault -- your progress through a track has
 * to survive disconnecting a note repository it never depended on.
 *
 * Three things have to agree, as with `job_search`, `core` and `obsidian`:
 *
 *   1. The migrations create everything in this schema.
 *   2. Every supabase-js client that touches it passes
 *      `db: { schema: LEARN_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard, alongside the others.
 *
 * Unlike the vault -- which had to be called `obsidian` because Supabase ships
 * its own `vault` schema -- this one gets the obvious name. `learn` collides
 * with nothing Supabase creates, and tests/coexistence.test.ts checks it.
 */
export const LEARN_SCHEMA = 'learn';

/**
 * A Supabase client bound to the learn schema.
 *
 * The schema rides in the client's type, so a function typed against this
 * cannot be handed a client that would silently read a workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LearnSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof LEARN_SCHEMA>;
