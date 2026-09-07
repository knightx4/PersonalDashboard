/**
 * The Postgres schema that holds the todo module.
 *
 * A fifth schema, for the same reason there is a fourth: a todo is not a
 * commerce fact, a recruiting fact or a note, and it does not arrive on the
 * shared mailbox sync either. `core` was the other candidate and is wrong --
 * core is for facts that arrive from outside and that no workspace owns, and a
 * todo is authored rather than ingested.
 *
 * Three things have to agree, as with `job_search`, `core` and `obsidian`:
 *
 *   1. The migrations create everything in this schema.
 *   2. Every supabase-js client that touches a todo passes
 *      `db: { schema: TODO_SCHEMA }`.
 *   3. The schema is listed under Settings → API → Exposed schemas in the
 *      Supabase dashboard, alongside the other four.
 *
 * The agenda reads several schemas, and a client is bound to exactly one, so it
 * holds several clients rather than one clever one. That is the cost of schema
 * separation and it is priced in: see lib/todo/agenda/load.ts.
 */
export const TODO_SCHEMA = 'todo';

/**
 * A Supabase client bound to the todo schema.
 *
 * The schema rides in the client's type, so a function typed against this
 * cannot be handed a client that would silently read a workspace's tables.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TodoSupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, typeof TODO_SCHEMA>;
