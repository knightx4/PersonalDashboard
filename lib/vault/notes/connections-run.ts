import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  CONNECTION_WINDOW_DAYS,
  pickConnections,
  type NeighbourPair,
  type PickedConnection,
} from '@/lib/vault/notes/connections';
import type { ConnectionForModel } from '@/lib/vault/notes/connections-model';

/**
 * One person's weekly connections (plan #1115): look back seven days, pick
 * what is worth saying, have the sentences written, store the rows.
 *
 * A week is keyed by the day the run looks back from. A second run on the
 * same day finds that day's rows and does nothing, so a retried cron call
 * never pays for the sentences twice. A week with nothing worth saying writes
 * nothing, and the page shows nothing.
 */

export type ConnectionRow = {
  user_id: string;
  week_ending: string;
  older_note_id: string;
  recent_note_ids: string[];
  sentence: string | null;
  similarity: number;
};

export type ConnectionRunPorts = {
  /** Whether rows already exist for this person and week. */
  hasWeek(userId: string, weekEnding: string): Promise<boolean>;
  /** obsidian.recent_note_neighbours for this person since `since`. */
  neighbours(userId: string, since: string): Promise<NeighbourPair[]>;
  /** The opening lines of each note, by id, ready for the model. */
  openings(userId: string, noteIds: string[]): Promise<Map<string, string>>;
  /** Sentences in the order of the groups; null where there is none. */
  sentences(groups: ConnectionForModel[], onSpend: (report: SpendReport) => void): Promise<(string | null)[]>;
  /** What a model call cost, against this person. */
  ledger(userId: string, report: SpendReport): Promise<void>;
  write(rows: ConnectionRow[]): Promise<void>;
};

export type ConnectionRunResult =
  | { status: 'already-run' }
  | { status: 'quiet'; pairs: number }
  | { status: 'written'; pairs: number; connections: number; sentences: number };

/** The day a run on `now` is keyed by, and the moment it looks back to. */
export function connectionWeek(now: Date): { weekEnding: string; since: string } {
  const since = new Date(now.getTime() - CONNECTION_WINDOW_DAYS * 86_400_000);
  return { weekEnding: now.toISOString().slice(0, 10), since: since.toISOString() };
}

export function toRows(
  userId: string,
  weekEnding: string,
  picked: readonly PickedConnection[],
  sentences: readonly (string | null)[],
): ConnectionRow[] {
  return picked.map((connection, index) => ({
    user_id: userId,
    week_ending: weekEnding,
    older_note_id: connection.older.id,
    recent_note_ids: connection.recent.map((note) => note.id),
    sentence: sentences[index] ?? null,
    similarity: connection.similarity,
  }));
}

export async function runConnectionsFor(
  ports: ConnectionRunPorts,
  userId: string,
  now: Date,
): Promise<ConnectionRunResult> {
  const { weekEnding, since } = connectionWeek(now);
  if (await ports.hasWeek(userId, weekEnding)) return { status: 'already-run' };

  const pairs = await ports.neighbours(userId, since);
  const picked = pickConnections(pairs);
  if (picked.length === 0) return { status: 'quiet', pairs: pairs.length };

  const ids = [...new Set(picked.flatMap((c) => [c.older.id, ...c.recent.map((note) => note.id)]))];
  const openings = await ports.openings(userId, ids);
  const groups: ConnectionForModel[] = picked.map((connection) => ({
    older: { title: connection.older.title, opening: openings.get(connection.older.id) ?? '' },
    recent: connection.recent.map((note) => ({ title: note.title, opening: openings.get(note.id) ?? '' })),
  }));

  const reports: SpendReport[] = [];
  const sentences = await ports.sentences(groups, (report) => reports.push(report));
  for (const report of reports) await ports.ledger(userId, report);

  const rows = toRows(userId, weekEnding, picked, sentences);
  await ports.write(rows);
  return {
    status: 'written',
    pairs: pairs.length,
    connections: rows.length,
    sentences: rows.filter((row) => row.sentence).length,
  };
}
