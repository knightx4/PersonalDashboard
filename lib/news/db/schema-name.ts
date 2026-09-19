/**
 * The Postgres schema that holds the news module.
 *
 * A sixth schema, on the same reasoning as the other five: a newsletter is not
 * a commerce fact or a recruiting fact, it does not arrive on the shared
 * mailbox sync, and it is delivered by a service that knows nothing about the
 * rest of the app.
 *
 * Three things have to agree, as with `learn`, `todo`, `job_search`, `core` and
 * `obsidian`:
 *
 *   1. The migrations create everything in this schema.
 *   2. Every supabase-js client that touches it passes
 *      `db: { schema: NEWS_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard, alongside the others.
 *
 * `news` collides with nothing Supabase ships, so it gets the obvious name --
 * unlike the notes workspace, which had to be called `obsidian` because
 * Supabase ships its own `vault` schema.
 */
export const NEWS_SCHEMA = 'news';

/**
 * A Supabase client bound to the news schema.
 *
 * The schema rides in the client's type, so a function typed against this
 * cannot be handed a client that would silently read a workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NewsSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof NEWS_SCHEMA>;
