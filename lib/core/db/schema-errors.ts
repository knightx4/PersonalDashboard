/**
 * Turning a missing Exposed-schemas entry into a sentence.
 *
 * Seven schemas back this app -- `public`, `job_search`, `core`, `obsidian`
 * (the vault workspace), `todo`, `learn` and `news` -- but PostgREST only
 * serves the ones it has been told to serve, under Settings -> API -> Exposed
 * schemas in the Supabase dashboard. It reads the same list out of the
 * database, which is where `migrations-news/0002` now writes it, so the fix is
 * a migration to re-run rather than a checkbox to remember -- but the
 * dashboard still overwrites it, so the box is still the thing that goes
 * wrong.
 *
 * When it is wrong, every query against the unlisted schema fails with
 * PGRST106. Nothing crashes: a select returns an error object the caller
 * usually ignores, so a count reads as zero and a profile reads as absent. The
 * app then behaves as though the user has no mailbox and has never onboarded --
 * which presents as an onboarding screen that loops back to itself forever,
 * with nothing in the logs that names the cause.
 *
 * So we name it. A misconfigured deployment should say what to change, not
 * quietly pretend the account is empty.
 */

/** PostgREST's code for "that schema is not in the exposed list". */
const SCHEMA_NOT_EXPOSED = 'PGRST106';

/**
 * Every schema this app reads through PostgREST.
 *
 * Named here rather than written into the message, because the message used to
 * carry a hardcoded list of four -- and when `learn` was added, the error it
 * raised said "make sure the list includes public, job_search, core, obsidian
 * and todo", which is a list the schema it was complaining about is not in.
 * Being told to check for the wrong thing is worse than being told nothing.
 */
const EXPOSED_SCHEMAS = [
  'public',
  'job_search',
  'core',
  'obsidian',
  'todo',
  'learn',
  'news',
] as const;

type PostgrestErrorish = { code?: string | null; message?: string | null } | null;

export class SchemaNotExposedError extends Error {
  constructor(readonly schema: string) {
    super(
      `The "${schema}" schema is not exposed by the API, so nothing in it can be read or written. ` +
        `In the Supabase dashboard open Settings → API → Exposed schemas and add "${schema}" to the ` +
        `list, which should end up holding ${EXPOSED_SCHEMAS.join(', ')}. No deploy is needed. ` +
        'Re-running supabase/migrations-news/0002_expose_news_to_postgrest.sql sets the same list ' +
        'from SQL. If it is already listed, PostgREST has not picked it up yet: run ' +
        "`notify pgrst, 'reload config'` in the SQL editor.",
    );
    this.name = 'SchemaNotExposedError';
  }
}

/**
 * Throw with an actionable message when a query failed only because its schema
 * is not exposed. Any other error is returned to the caller to handle.
 */
export function assertSchemaExposed(error: PostgrestErrorish, schema: string): void {
  if (error?.code === SCHEMA_NOT_EXPOSED) {
    throw new SchemaNotExposedError(schema);
  }
}
