import type { JevResult, JevYesNoAnswer } from '@/lib/jev/wire';
import { gateRefusal, gateVerdict, type GateNote, type GateOutcome } from './gate';

/**
 * One person's turn of Maya's hourly job (plan #1289): which notes Jev is
 * asked about, and which of them Maya writes on.
 *
 * No I/O. inngest/vault/maya-gate.ts supplies the ports, and the tests supply
 * their own, so the rules below are checked without a database, Jev or a
 * model.
 *
 * Which notes. A live note whose text changed within LOOKBACK_HOURS, at a
 * version (blob_sha) Jev has not been asked about, on a note with no thread.
 * The sync writes a note only when its text changes, so updated_at is when it
 * was written or last grew. The lookback is what stops the first tick from
 * treating the whole vault as new: every note came in with the full sync this
 * month, and a job that started from "every version not yet checked" would
 * put all 1,293 of them to Jev and write its daily cap on old notes. With the
 * window, a note older than a day and a half is never asked about unless it
 * changes again.
 *
 * Once per version. Every note the job reads gets one row in
 * obsidian.maya_gate_checks at its blob_sha. The one row that is asked about
 * again is a 'failed' one with no probability, meaning Jev itself did not
 * answer (a timeout, a rate limit, no key): the note is tried on the next tick
 * while it is still inside the window, and the row is overwritten. A note that
 * passed but whose thought failed keeps its probability and is not asked
 * again, so a failing thought model does not spend Opus every hour.
 *
 * Which get a thought. Only those Jev clears at MAYA_GATE_THRESHOLD, highest
 * probability first, and no more than MAYA_DAILY_THOUGHTS automatic threads in
 * any 24 hours. A passing note over the cap is recorded 'skip' with its
 * probability. A thought with no points is not stored (the note page's rule,
 * plan #1285), and its note is recorded 'skip' too.
 */

/** How far back a changed note is still new. The vault syncs daily at 12:33 UTC. */
export const MAYA_GATE_LOOKBACK_HOURS = 36;

/** The most automatic threads Maya opens for one person in any 24 hours. */
export const MAYA_DAILY_THOUGHTS = 3;

/** The most notes one tick puts to Jev for one person; the rest wait an hour. */
export const MAYA_GATE_ASKS_PER_RUN = 40;

/**
 * A thought is started only while the run is younger than this. One thought
 * is an Opus call with web search and can take two minutes, and the route
 * stops at five. A passing note not reached is left unrecorded, so the next
 * tick asks about it again.
 */
export const MAYA_THINK_BUDGET_MS = 150_000;

export type GateCandidate = GateNote & { id: string; blobSha: string };

export type GateCheckRow = {
  noteId: string;
  blobSha: string;
  outcome: GateOutcome;
  probability: number | null;
  jevModel: string | null;
};

export type PriorCheck = {
  noteId: string;
  blobSha: string;
  outcome: GateOutcome;
  probability: number | null;
};

export type ThinkResult =
  | { ok: true; threadId: string }
  | { ok: false; empty: boolean; detail: string };

export type GateRunPorts = {
  /** Live notes whose updated_at is at or after `since`. */
  changedNotes(userId: string, since: Date): Promise<GateCandidate[]>;
  /** The gate checks already written for these notes, at any version. */
  priorChecks(userId: string, noteIds: string[]): Promise<PriorCheck[]>;
  /** Which of these notes already have a thread with Maya. */
  threadedNotes(userId: string, noteIds: string[]): Promise<Set<string>>;
  /** jevEnabledFor, once per person per run. */
  jevEnabled(userId: string): Promise<boolean>;
  /** Put MAYA_GATE_QUESTION to Jev about one note. Never throws. */
  ask(userId: string, note: GateCandidate): Promise<JevResult<JevYesNoAnswer>>;
  /** Automatic threads this person has had opened since `since`. */
  automaticSince(userId: string, since: Date): Promise<number>;
  /** Have Maya write on the note and store it as an automatic thread. */
  think(userId: string, note: GateCandidate): Promise<ThinkResult>;
  /** Upsert on (note_id, blob_sha). */
  record(userId: string, rows: GateCheckRow[]): Promise<void>;
  /** Milliseconds since the run started; tests fix it. */
  elapsedMs(): number;
};

export type GateRunResult = {
  read: number;
  asked: number;
  passed: number;
  thoughts: number;
  deferred: number;
  failed: number;
};

/** The notes to ask about: new versions with no thread, and Jev's own failures again. */
export function pendingNotes(
  notes: GateCandidate[],
  prior: PriorCheck[],
  threaded: Set<string>,
): GateCandidate[] {
  const checked = new Map(prior.map((row) => [`${row.noteId}:${row.blobSha}`, row]));
  return notes.filter((note) => {
    if (threaded.has(note.id)) return false;
    const row = checked.get(`${note.id}:${note.blobSha}`);
    if (!row) return true;
    return row.outcome === 'failed' && row.probability === null;
  });
}

export async function runMayaGateFor(
  ports: GateRunPorts,
  userId: string,
  now: Date,
): Promise<GateRunResult> {
  const result: GateRunResult = { read: 0, asked: 0, passed: 0, thoughts: 0, deferred: 0, failed: 0 };

  const since = new Date(now.getTime() - MAYA_GATE_LOOKBACK_HOURS * 3_600_000);
  const changed = await ports.changedNotes(userId, since);
  if (changed.length === 0) return result;

  const ids = changed.map((note) => note.id);
  const [prior, threaded] = await Promise.all([
    ports.priorChecks(userId, ids),
    ports.threadedNotes(userId, ids),
  ]);
  const pending = pendingNotes(changed, prior, threaded).slice(0, MAYA_GATE_ASKS_PER_RUN);
  if (pending.length === 0) return result;
  result.read = pending.length;

  const enabled = await ports.jevEnabled(userId);
  const rows: GateCheckRow[] = [];
  const passers: { note: GateCandidate; row: GateCheckRow }[] = [];

  for (const note of pending) {
    if (gateRefusal(note)) {
      rows.push({ noteId: note.id, blobSha: note.blobSha, outcome: 'skip', probability: null, jevModel: null });
      continue;
    }
    let verdict = gateVerdict(null, false);
    if (enabled) {
      result.asked += 1;
      verdict = gateVerdict(await ports.ask(userId, note), true);
    }
    const row: GateCheckRow = {
      noteId: note.id,
      blobSha: note.blobSha,
      outcome: verdict.outcome,
      probability: verdict.probability,
      jevModel: verdict.jevModel,
    };
    if (verdict.outcome === 'failed') result.failed += 1;
    if (verdict.passes) passers.push({ note, row });
    else rows.push(row);
  }
  await ports.record(userId, rows);

  result.passed = passers.length;
  if (passers.length === 0) return result;

  passers.sort((a, b) => (b.row.probability ?? 0) - (a.row.probability ?? 0));
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  let room = MAYA_DAILY_THOUGHTS - (await ports.automaticSince(userId, dayAgo));

  for (const { note, row } of passers) {
    if (room <= 0) {
      await ports.record(userId, [{ ...row, outcome: 'skip' }]);
      continue;
    }
    if (ports.elapsedMs() > MAYA_THINK_BUDGET_MS) {
      result.deferred += 1;
      continue;
    }
    const thought = await ports.think(userId, note);
    if (thought.ok) {
      room -= 1;
      result.thoughts += 1;
      await ports.record(userId, [{ ...row, outcome: 'thought' }]);
    } else {
      if (!thought.empty) result.failed += 1;
      await ports.record(userId, [{ ...row, outcome: thought.empty ? 'skip' : 'failed' }]);
    }
  }
  return result;
}
