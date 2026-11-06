/**
 * A watch Dash wrote for someone on People, as its card in the thread draws
 * it (plan #3030.1.2): what it checks, how often, the tables it reads, what
 * a text would say, and where it stands. No server imports, so the client
 * card can use it.
 *
 * The card hangs off the set_reach_out change that proposed the watch: its
 * subject_ref is `you.advisor_watches:<id>`, and the thread reads the watch
 * as it is now (lib/you/watch-decide.ts), since Approve and Decline change
 * the watch and not the change.
 */
import { cadenceWords } from '@/lib/you/advisor-watch-words';

export { cadenceWords };

export const WATCH_STATUSES = ['proposed', 'active', 'declined', 'paused', 'stopped'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

/** What the card's two presses, and the toast's Undo on Decline, ask for. */
export const WATCH_DECISIONS = ['approve', 'decline', 'reopen'] as const;
export type WatchDecision = (typeof WATCH_DECISIONS)[number];

export type WatchCard = {
  id: string;
  about: string;
  sendsWhen: string;
  sample: string;
  everyDays: number;
  mode: 'each' | 'roundup';
  tables: string[];
  status: WatchStatus;
  /** Rows the query matched when Dash wrote it. */
  matched: number | null;
};

export const WATCH_TABLE = 'you.advisor_watches';

/** The columns the card reads. */
export const WATCH_CARD_SELECT = 'id, about, sends_when, sample, every_days, mode, tables, status, matched';

/** The watch a set_reach_out change proposed, by its id; null for any other change. */
export function watchIdOf(change: { kind: string; writtenTable: string | null; writtenRef: string | null }): string | null {
  return change.kind === 'set_reach_out' && change.writtenTable === WATCH_TABLE && change.writtenRef ? change.writtenRef : null;
}

/** A you.advisor_watches row as the card reads it; null when it is not one. */
export function watchCardFrom(row: Record<string, unknown> | null | undefined): WatchCard | null {
  if (!row || typeof row.id !== 'string') return null;
  const status = (WATCH_STATUSES as readonly unknown[]).includes(row.status) ? (row.status as WatchStatus) : null;
  if (!status) return null;
  return {
    id: row.id,
    about: String(row.about ?? ''),
    sendsWhen: String(row.sends_when ?? ''),
    sample: String(row.sample ?? ''),
    everyDays: typeof row.every_days === 'number' ? row.every_days : 1,
    mode: row.mode === 'roundup' ? 'roundup' : 'each',
    tables: Array.isArray(row.tables) ? row.tables.map(String) : [],
    status,
    matched: typeof row.matched === 'number' ? row.matched : null,
  };
}

/** How often it is checked and what a match sends: "Every day, a text for each new match". */
export function watchRhythm(watch: Pick<WatchCard, 'everyDays' | 'mode'>): string {
  const cadence = cadenceWords(watch.everyDays);
  const texts = watch.mode === 'roundup' ? 'one text about everything new' : 'a text for each new match';
  return `${cadence[0].toUpperCase()}${cadence.slice(1)}, ${texts}`;
}

/** How many rows match now, as the card says it; null when it was not counted. */
export function matchedWords(matched: number | null): string | null {
  if (matched === null) return null;
  if (matched === 0) return 'Nothing matches yet';
  return matched === 1 ? 'One row matches now' : `${matched} rows match now`;
}

/** What became of the watch once it was decided, under its status word. */
export const WATCH_STATUS_WORDS: Record<WatchStatus, { label: string; note: string }> = {
  proposed: { label: 'Waiting for your OK', note: 'Nothing runs until you approve it.' },
  active: { label: 'Approved', note: 'It runs on its cadence from now on.' },
  declined: { label: 'Declined', note: 'Nothing runs.' },
  paused: { label: 'Paused', note: 'Three runs in a row failed, so it stopped trying.' },
  stopped: { label: 'Stopped', note: 'Nothing runs.' },
};

/** The status each decision moves the watch from, and to. */
export const WATCH_MOVES: Record<WatchDecision, { from: WatchStatus; to: WatchStatus }> = {
  approve: { from: 'proposed', to: 'active' },
  decline: { from: 'proposed', to: 'declined' },
  reopen: { from: 'declined', to: 'proposed' },
};
