import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { Sql } from '@/lib/learn/catalogue/store';
import { nearestStructureUnits, type NearestStructureUnit } from '@/lib/learn/catalogue/structure-store';
import { embedTexts } from '@/lib/learn/embed/embed';
import { mergeMatches, type StoredDocumentInfo } from '@/lib/learn/levels/stored-sources';

/**
 * Finding the stored weeks a goal is about (plan #2247.10).
 *
 * The goal and each of its performances are embedded as queries in one call,
 * and each vector is searched against every unit of every stored structure
 * document. The best match of each unit across the searches is kept, so a
 * week that serves two performances is listed once. The textbooks of the
 * matched documents are read in the same pass, for the territory's canon.
 *
 * Never throws: with no embedding key, or the search failing, the draft goes
 * ahead on the sources it was given and the reason comes back to be logged.
 */

/** Units each search returns at most. */
const PER_QUERY = 30;
/** Below this a unit is about something else. voyage-3.5-lite puts unrelated weeks near 0.3. */
export const MIN_UNIT_SIMILARITY = 0.45;

export type StoredUnitsFound =
  | { ok: true; matches: NearestStructureUnit[]; documents: StoredDocumentInfo[] }
  | { ok: false; detail: string };

/** The ports the search runs through, so a test can run it without a network or a database. */
export type StoredUnitPorts = {
  embed: (texts: string[], onSpend?: SpendSink) => Promise<{ ok: true; vectors: number[][] } | { ok: false; detail: string }>;
  nearest: (vector: number[]) => Promise<NearestStructureUnit[]>;
  textbooks: (itemIds: string[]) => Promise<StoredDocumentInfo[]>;
};

export function liveStoredUnitPorts(sql: Sql): StoredUnitPorts {
  return {
    embed: async (texts, onSpend) => {
      const outcome = await embedTexts({ texts, inputType: 'query', onSpend });
      return outcome.ok ? { ok: true, vectors: outcome.vectors } : { ok: false, detail: `${outcome.reason}: ${outcome.detail}` };
    },
    nearest: (vector) => nearestStructureUnits(sql, vector, { limit: PER_QUERY, minSimilarity: MIN_UNIT_SIMILARITY }),
    textbooks: async (itemIds) => {
      if (itemIds.length === 0) return [];
      const rows = await sql<{ item_id: string; textbooks: string[] }[]>`
        select item_id, textbooks from learn.catalogue_structures where item_id = any(${itemIds}::uuid[])`;
      return rows.map((row) => ({ itemId: row.item_id, textbooks: row.textbooks }));
    },
  };
}

/** The queries a goal is searched by: its name and about-line, then each performance. */
export function storedUnitQueries(goal: { name: string; about?: string | null }, performances: readonly string[]): string[] {
  const about = goal.about?.trim();
  const head = `${goal.name.trim()}${about ? `. ${about}` : ''}`;
  return [head, ...performances.map((p) => p.trim())].filter((q) => q !== '');
}

export async function findStoredUnits(
  ports: StoredUnitPorts,
  goal: { name: string; about?: string | null },
  performances: readonly string[],
  onSpend?: SpendSink,
): Promise<StoredUnitsFound> {
  const queries = storedUnitQueries(goal, performances);
  if (queries.length === 0) return { ok: true, matches: [], documents: [] };
  try {
    const embedded = await ports.embed(queries, onSpend);
    if (!embedded.ok) return { ok: false, detail: embedded.detail };
    const lists = await Promise.all(embedded.vectors.map((vector) => ports.nearest(vector)));
    const matches = mergeMatches(lists);
    const documents = await ports.textbooks([...new Set(matches.map((m) => m.itemId))]);
    return { ok: true, matches, documents };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
