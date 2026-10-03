import { pageFor, sourceFor } from '@/lib/sources/catalogue';
import { pageTitle } from '@/lib/core/refs';

/**
 * Any row written out for Dash, from the row itself and its catalogue entry
 * (plan #1441). The reply on a thread with no reader of its own
 * (lib/thread/ask.ts) is given this, so a file's comment is answered from
 * the file's whole body and a todo's from the todo, without each table
 * writing its own context.
 *
 * Every column with something in it is shown, under its own name, except the
 * owner and what no one reads (embeddings, search vectors). A long text is
 * cut, and the whole row has a ceiling, so a long file costs a long file and
 * no more.
 */

/** The most one column contributes. */
export const COLUMN_MAX = 40_000;
/** The most the whole row contributes. */
export const ROW_MAX = 60_000;

/** Columns that are bookkeeping or machine-only, never worth the tokens. */
const SKIPPED = new Set(['user_id', 'embedding', 'search_vector', 'search_tsv', 'fts', 'tsv']);

/**
 * Columns one table keeps from Dash. A vault note's path names its folder,
 * and the privacy page promises a note's folder and path never reach a model
 * (lib/vault/map/rules.ts); the rest are sync bookkeeping.
 */
const HIDDEN: Readonly<Record<string, ReadonlySet<string>>> = {
  'obsidian.notes': new Set(['path', 'connection_id', 'blob_sha']),
};

function isMachineOnly(name: string, value: unknown, hidden?: ReadonlySet<string>): boolean {
  if (SKIPPED.has(name) || hidden?.has(name) || name.endsWith('_embedding')) return true;
  // A vector read through the API arrives as a long array of numbers.
  return Array.isArray(value) && value.length > 64 && value.every((item) => typeof item === 'number');
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.trim() ? text : null;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n(cut here: ${text.length - max} more characters)`;
}

/** The row as the message names it: what the table holds, its title, then each column. */
export function rowText(table: string, row: Readonly<Record<string, unknown>>): string {
  const source = sourceFor(table);
  const page = pageFor(table)?.page;
  const title = page ? pageTitle(page, row) : null;

  const lines = ['## The row', ''];
  lines.push(source ? `A row of ${table}: ${source.holds}` : `A row of ${table}.`);
  if (source?.note) lines.push(`About this table: ${source.note}`);
  if (title) lines.push(`Called: ${title}`);

  const hidden = HIDDEN[table];
  let left = ROW_MAX;
  for (const [name, value] of Object.entries(row)) {
    if (isMachineOnly(name, value, hidden)) continue;
    const text = asText(value);
    if (!text) continue;
    if (left <= 0) {
      lines.push('', '(The rest of the row is left out for length.)');
      break;
    }
    const shown = clip(text, Math.min(COLUMN_MAX, left));
    left -= shown.length;
    lines.push('', `### ${name}`, '', shown);
  }
  return lines.join('\n') + '\n';
}
