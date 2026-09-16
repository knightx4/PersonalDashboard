/**
 * Turning a missing Exposed-schemas entry into a sentence.
 *
 * Seven schemas back this app -- `public`, `job_search`, `core`, `obsidian`
 * (the vault workspace), `todo`, `learn` and `news` -- but
 * PostgREST only serves the ones listed under Settings -> API -> Exposed
 * schemas in the Supabase dashboard. That list is not in version control and
 * does not survive a project restore, so it is the step that gets forgotten.
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
 * PostgREST's code for "there is no such table", and Postgres' own.
 *
 * Which is a different fault from an unexposed schema and has a different fix:
 * the schema is being served, the table inside it was never created, because a
 * migration sitting in `supabase/migrations-*` has not been applied to the
 * project. The code deploys on merge and the migrations do not, so the two
 * drift apart in exactly one direction -- deployed code asking for a table
 * that is not there yet.
 */
const TABLE_NOT_FOUND = 'PGRST205';
const UNDEFINED_TABLE = '42P01';

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
        `list, which should end up holding ${EXPOSED_SCHEMAS.join(', ')}. No migration or deploy ` +
        'is needed. If it is already listed, PostgREST has not picked it up yet: run ' +
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

/**
 * Whether a query failed only because its table does not exist.
 *
 * For the caller that can carry on without it. A table that arrived with a
 * feature's own migration is missing on a deployment that has not run it, and
 * the part of the page that does not need that table should still draw -- a
 * nav badge count is not worth the whole module. The caller decides; this only
 * tells it which failure it is looking at, so that a permission error or a bad
 * column never gets mistaken for one and swallowed.
 */
export function isMissingTable(error: PostgrestErrorish): boolean {
  return error?.code === TABLE_NOT_FOUND || error?.code === UNDEFINED_TABLE;
}
