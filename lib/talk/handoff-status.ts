import type { HandoffState } from './handoff';

/**
 * How a hand-off to a Claude Code session reads when someone asks "how's it
 * going?" (plan #3005.5): who sent it, what it is for, where it stands and how
 * long it has been at that. Pure, so the lookup a bot calls and the tests read
 * the same words.
 */

/** A session hand-off row as the status reads it. */
export type SessionStatusInput = {
  id: string;
  /** The bot's name; null is Ask Dash. */
  sender: string | null;
  request: string;
  state: HandoffState;
  error: string | null;
  createdAt: string;
  firedAt: string | null;
  finishedAt: string | null;
  lastSeenAt: string | null;
};

export type SessionStatus = {
  id: string;
  sender: string;
  purpose: string;
  state: HandoffState;
  /** "Waiting to start", "Working", "Done" or "Stopped". */
  stateWord: string;
  /** How long it waited, ran or took, in words: "4 min". */
  duration: string;
  /** The sentence a bot can say as it is. */
  line: string;
};

/** A running session not heard from for this long is called quiet. */
export const SESSION_QUIET_MS = 15 * 60 * 1000;

const PURPOSE_CHARS = 140;

const STATE_WORD: Record<HandoffState, string> = {
  queued: 'Waiting to start',
  running: 'Working',
  done: 'Done',
  failed: 'Stopped',
};

/** Milliseconds as "under a minute", "4 min", "2 h 5 min" or "3 days". */
export function durationWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The request cut to one line for a list. */
export function purposeOf(request: string): string {
  const one = request.replace(/\s+/g, ' ').trim();
  return one.length > PURPOSE_CHARS ? `${one.slice(0, PURPOSE_CHARS - 1).trimEnd()}…` : one;
}

function at(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Whether the hand-off is still open: waiting or working. */
export function isOpenState(state: HandoffState): boolean {
  return state === 'queued' || state === 'running';
}

/** One hand-off as the person is told of it, at `now` (ms). */
export function sessionStatus(row: SessionStatusInput, now: number): SessionStatus {
  const created = at(row.createdAt) ?? now;
  const started = at(row.firedAt) ?? created;
  const finished = at(row.finishedAt);
  let from = created;
  let to = now;
  if (row.state === 'running') from = started;
  if (row.state === 'done' || row.state === 'failed') {
    from = started;
    to = finished ?? now;
  }
  const duration = durationWords(to - from);
  const sender = row.sender?.trim() || 'Dash';
  const purpose = purposeOf(row.request);

  let line: string;
  if (row.state === 'queued') {
    line = `Waiting to start for ${duration}.`;
  } else if (row.state === 'running') {
    const seen = at(row.lastSeenAt);
    line =
      seen !== null && now - seen > SESSION_QUIET_MS
        ? `Working for ${duration}, but nothing heard from it for ${durationWords(now - seen)}.`
        : `Working for ${duration}.`;
  } else if (row.state === 'done') {
    line = `Done in ${duration}.`;
  } else {
    const why = row.error?.replace(/\s+/g, ' ').trim();
    line = `Stopped after ${duration}${why ? `: ${why.slice(0, 200)}` : '.'}`;
  }
  return { id: row.id, sender, purpose, state: row.state, stateWord: STATE_WORD[row.state], duration, line };
}
