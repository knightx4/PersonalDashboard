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
 * nothing, and the page shows nothing. A week after one with no rows looks
 * back fourteen days, so a run that failed is made up the next week.
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

/**
 * What one person's run did. `caughtUp` is set when the week before had no
 * rows, so this run read both weeks.
 */
export type ConnectionRunResult =
  | { status: 'already-run' }
  | { status: 'quiet'; pairs: number; caughtUp?: true }
  | { status: 'written'; pairs: number; connections: number; sentences: number; caughtUp?: true };

/**
 * The day a run on `now` is keyed by, and the moment it looks back to: seven
 * days, or fourteen when it is catching up on the week before.
 */
export function connectionWeek(
  now: Date,
  catchUp = false,
): { weekEnding: string; since: string } {
  const days = catchUp ? 2 * CONNECTION_WINDOW_DAYS : CONNECTION_WINDOW_DAYS;
  const since = new Date(now.getTime() - days * 86_400_000);
  return { weekEnding: now.toISOString().slice(0, 10), since: since.toISOString() };
}

/** The day the run a week before `now` was keyed by. */
export function previousWeekEnding(now: Date): string {
  return connectionWeek(new Date(now.getTime() - CONNECTION_WINDOW_DAYS * 86_400_000)).weekEnding;
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
  const { weekEnding } = connectionWeek(now);
  if (await ports.hasWeek(userId, weekEnding)) return { status: 'already-run' };

  // The catch-up. Nothing retries a weekly run that failed: on 28 September
  // the model credit ran out and the week was lost. So a run whose week before
  // has no rows reads both weeks, keyed under this one. Run as a separate
  // week, the earlier one would overlap this one, because the neighbour lookup
  // takes a start and no end. A week that was quiet rather than lost has no
  // rows either, and reading it again costs one lookup and no model call
  // unless it now has something to say.
  const catchUp = !(await ports.hasWeek(userId, previousWeekEnding(now)));
  const { since } = connectionWeek(now, catchUp);
  const caught = catchUp ? ({ caughtUp: true } as const) : {};

  const pairs = await ports.neighbours(userId, since);
  const picked = pickConnections(pairs);
  if (picked.length === 0) return { status: 'quiet', pairs: pairs.length, ...caught };

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
    ...caught,
  };
}
