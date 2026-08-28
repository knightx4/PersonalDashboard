/**
 * The Postgres schema that holds ingestion.
 *
 * Neither workspace owns raw mail. An order confirmation and a rejection letter
 * arrive through the same mailbox, on the same sync, and the fact that a
 * message exists is not a commerce fact or a recruiting fact -- so the envelope
 * lives here, once, and each workspace keeps only its own verdict about it.
 *
 * Three things have to agree, as with `job_search`:
 *
 *   1. The migrations create everything in this schema.
 *   2. Every supabase-js client that touches ingestion passes
 *      `db: { schema: CORE_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard, alongside `public` and `job_search`.
 *
 * Reading a message *with* a workspace's verdict does not need this client:
 * each schema has an `inbox_messages` view that joins the two, because
 * PostgREST cannot embed across schemas.
 */
export const CORE_SCHEMA = 'core';

/**
 * A Supabase client bound to the ingestion schema.
 *
 * As with the job side, the schema rides in the client's type, so a function
 * typed against this cannot be handed a client that would silently read a
 * workspace's tables instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CoreSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof CORE_SCHEMA>;
