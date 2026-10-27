/**
 * What scripts/sql.ts will send to the live database: a select, or an insert
 * or update scoped to the owner. A delete, truncate or schema change is
 * refused, so those still pass a person's confirmation in the Supabase
 * connector or a migration file reviewed on its way to main.
 *
 * The owner is whoever the database says it is (core.app_settings, read
 * through `OWNER_QUERY`), so no account is named here. A statement may write
 * `:owner` where it means the owner's id, quoted or not, and `withOwner`
 * puts the id in before the check, so a skill or a routine never has to
 * spell it.
 */

/** Reads the owner's user id; null until core.app_settings names one. */
export const OWNER_QUERY = 'select core.dev_owner_id() as id';

const OWNER_TOKEN = /'?(?<![:\w]):owner\b'?/g;

/** The statement with each `:owner` replaced by the owner's id as a quoted literal. */
export function withOwner(statement: string, ownerId: string): string {
  return statement.replace(OWNER_TOKEN, `'${ownerId}'`);
}

/** Words that make a statement more than a read or an ordinary write. */
const REFUSED =
  /\b(?:delete\s+from|truncate|drop|alter|create|grant|revoke|comment\s+on|copy|vacuum|reindex|cluster|lock|call|execute|set\s+role|reset\s+role)\b/i;

const WRITES = /\b(?:insert\s+into|update\s+[\w."]+\s+set|merge\s+into)\b/i;

/** The statement without quoted text and comments, which say nothing about what runs. */
function words(statement: string): string {
  return statement
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, 'x')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Why the statement cannot be sent, or null when it can. */
export function sqlRefusal(statement: string, ownerId: string | null): string | null {
  const bare = words(statement).trim().replace(/;\s*$/, '');
  if (bare.includes(';')) {
    return /^\s*set\s+local\b/i.test(bare)
      ? 'Pass each `set local` as --set name=value, and send the statement after it alone.'
      : 'Send one statement per call.';
  }
  if (REFUSED.test(bare) || /^do\b/i.test(bare)) {
    return (
      'Deletes, truncates and schema changes are not sent from here. A schema change goes in a ' +
      'migration file; a delete goes through the Supabase connector, where a person confirms it.'
    );
  }
  if (WRITES.test(bare)) {
    if (!ownerId) {
      return 'No owner is set, so no write can be scoped to one. Set core.app_settings.owner_user_id first (docs/SETUP.md).';
    }
    if (!statement.includes(ownerId))
      return 'A write must be scoped to the owner: write :owner where it names them.';
  }
  return null;
}
