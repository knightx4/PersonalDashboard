import { MATCHED_SET_CAP } from '@/lib/ask/db';

/**
 * Sets of rows a lookup matched (plan #2472.1, feature #2472). A query_rows
 * call that lists or counts rows hands back every row it matched, up to
 * SET_CAP, and runDash (lib/dash/loop.ts) keeps them for the rest of the
 * answer under a name the model is told, "set 1", "set 2" and so on. A write
 * can then take that name in place of a list of refs, and turns it into the
 * table and row ids with rowsOfSet. The set's rows count as seen, so the
 * writes that check `seen` row by row accept them.
 *
 * Sets are kept on `seen` itself (DashSeen.sets), since `seen` already
 * reaches every write's context; nothing about them is saved with the turn.
 */

/** The most rows a set can hand to one change: the bulk writes' own cap. */
export const SET_CAP = MATCHED_SET_CAP;

/** The rows one lookup matched. */
export type RowSet = {
  /** As the model is told it: "set 1". */
  name: string;
  /** schema.table, as query_rows was asked. */
  table: string;
  /** Every matched row's ref, or none when more than SET_CAP matched. */
  refs: readonly string[];
  /** How many rows the lookup matched, which may be over SET_CAP. */
  size: number;
};

/** The sets made in one answer, by name. */
export type RowSets = ReadonlyMap<string, RowSet>;

/**
 * Whether Dash has seen a row: a lookup returned it or matched it into a
 * set, or for some calls, the page shows it. `sets` carries the answer's
 * sets to the writes; absent where no lookup can make one.
 */
export type DashSeen = ((table: string, ref: string) => boolean) & { sets?: RowSets };

/** The name of the answer's nth set, counting from 1. */
export function setName(n: number): string {
  return `set ${n}`;
}

/** A name as the model may write it ("set 2", "Set 2", "2") in the form sets are kept under, or null. */
export function parseSetName(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return setName(raw);
  if (typeof raw !== 'string') return null;
  const match = raw.trim().toLowerCase().match(/^(?:set\s*)?(\d+)$/);
  return match && Number(match[1]) > 0 ? setName(Number(match[1])) : null;
}

/** What rowsOfSet gives a write: the table and every row id to change, or why not. */
export type SetRows = { ok: true; name: string; table: string; ids: string[] } | { ok: false; error: string };

/**
 * The table and row ids a set name stands for, for a write to change. Refuses
 * a name that is not a set's, a set no lookup in this answer made, a set of
 * another table than `tables` (the one, or ones, the write works on), a set
 * whose lookup matched nothing, and a set over SET_CAP, saying its size.
 */
export function rowsOfSet(seen: DashSeen, raw: unknown, tables: string | readonly string[]): SetRows {
  const expected = typeof tables === 'string' ? [tables] : tables;
  const name = parseSetName(raw);
  if (!name) return { ok: false, error: 'set is the name a query_rows lookup gave its matched rows, such as "set 1".' };
  const set = seen.sets?.get(name);
  if (!set) {
    const made = [...(seen.sets?.keys() ?? [])];
    const known = made.length > 0 ? ` The sets so far are ${made.join(', ')}.` : ' No lookup in this answer has made one yet.';
    return {
      ok: false,
      error: `There is no ${name} in this answer. A query_rows lookup that lists or counts rows names one, and sets last only for the answer that made them.${known}`,
    };
  }
  if (!expected.includes(set.table)) {
    return { ok: false, error: `${name} holds rows of ${set.table}, and this change works on ${expected.join(' or ')}.` };
  }
  if (set.size === 0) {
    return { ok: false, error: `${name} is empty: its lookup matched no rows, so there is nothing to change.` };
  }
  if (set.size > SET_CAP || set.refs.length < set.size) {
    return {
      ok: false,
      error: `${name} holds ${set.size} rows, more than the ${SET_CAP} one change can take. Narrow the lookup with another condition and use the set it names.`,
    };
  }
  return { ok: true, name, table: set.table, ids: [...set.refs] };
}
