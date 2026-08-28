/**
 * The Postgres schema this app owns.
 *
 * Not `public`. Supabase bills per project rather than per app, so several apps
 * live in one project by taking a schema each — which costs nothing and is also
 * the only arrangement under which this app and Shopping Manager can share a
 * database at all: their `public` schemas collide on four table names, six enum
 * types and two functions.
 *
 * Three things have to agree for this to work, and they are in three different
 * places, so they are listed here:
 *
 *   1. The migrations create everything in this schema (`set search_path`).
 *   2. Every supabase-js client passes `db: { schema: APP_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard. Without that, PostgREST returns "The schema must be
 *      one of the following" and nothing works — and it is the step that is not
 *      in this repository, so it is the one that gets forgotten.
 *
 * `auth` is untouched by all of this: auth.users is shared on purpose, which is
 * what gives one login across every app in the project.
 */
export const APP_SCHEMA = 'job_search';

/**
 * A Supabase client bound to this app's schema.
 *
 * supabase-js carries the schema in its type, so a function typed with the bare
 * `SupabaseClient` will not accept one of ours. That is a useful strictness
 * rather than a nuisance: it means a client built without
 * `db: { schema: APP_SCHEMA }` — which would silently query `public` and find
 * another app's tables, or nothing at all — does not typecheck.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof APP_SCHEMA>;

/**
 * The Storage bucket this app owns.
 *
 * Buckets are project-wide, not schema-scoped — the one place where sharing a
 * project is not automatic isolation. A distinct bucket name keeps this app's
 * files from colliding with another app's, and keeps "delete everything" from
 * reaching into somebody else's.
 */
export const APP_STORAGE_BUCKET = 'job-search';
