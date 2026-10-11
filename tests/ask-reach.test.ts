/**
 * Every table the catalogue declares as holding what the person wrote, wants,
 * did or has is one Dash can read (lib/ask/list-rows.ts).
 *
 * Dash's lookups used to be written one table at a time, and a table nobody
 * wrote one for was invisible to it: asked on 7 October 2026 for "a good
 * YouTube video to watch", it said it had no way to, with 122 videos on the
 * watch list. list_rows reads the catalogue instead, so a new source is
 * readable the day it is declared. This holds that, and that the columns it
 * reads and orders by exist, so the read does not fail when it is asked.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { SOURCES } from '@/lib/sources/catalogue';
import { LISTABLE } from '@/lib/ask/list-rows';
import { sql } from './helpers/db';

/**
 * Sources Dash cannot list, each with why. Tied to their owner through a join,
 * which list_rows cannot filter on.
 */
const UNLISTED: Record<string, string> = {
  'public.order_items': 'Owned through orders; spend_by_merchant and open_row on the order read them.',
};

afterAll(async () => {
  await sql.end();
});

describe('what Dash can reach', () => {
  it('lists every source but the ones that say why not', () => {
    const listable = new Set(LISTABLE.map((s) => s.table));
    const unreachable = SOURCES.filter((s) => !listable.has(s.table) && !(s.table in UNLISTED)).map(
      (s) =>
        `${s.table} is a source Dash cannot read: give it an owner column list_rows can filter on, or add it to UNLISTED with the reason.`,
    );
    expect(unreachable).toEqual([]);
  });

  it('orders each listable table by a column that exists, or by created_at', async () => {
    const rows = await sql<{ t: string; c: string }[]>`
      select table_schema || '.' || table_name as t, column_name as c from information_schema.columns`;
    const present = new Set(rows.map((r) => `${r.t}.${r.c}`));
    const tables = new Set(rows.map((r) => r.t));
    const unordered = LISTABLE.filter((s) => tables.has(s.table) && !present.has(`${s.table}.${s.newest ?? 'created_at'}`)).map(
      (s) => `${s.table} has no created_at: name the column that orders it newest first as \`newest\` in its sources.ts.`,
    );
    expect(unordered).toEqual([]);
  });
});
