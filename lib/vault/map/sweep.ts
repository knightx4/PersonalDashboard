import { canStartAnotherBatch } from '@/lib/core/inbox/pump-budget';
import type { NoteSkip } from '@/lib/learn/graph/note-chunks';
import type { AcceptResult } from '@/lib/vault/map/accept';
import type { MapNote, ProposeResult } from '@/lib/vault/map/extract';
import type { NoteMapProposal } from '@/lib/vault/map/proposal';
import { tooShortForMap, whyNotRead } from '@/lib/vault/map/rules';

/**
 * The sweep: every note in the vault read into the map, a few minutes at a
 * time (plan #757).
 *
 * One call works through notes in path order until pump-budget says there is
 * no time for another batch, and saves the last path after each batch. The
 * next call starts after that path. Nothing chains invocations: the cron in
 * supabase/migrations/0094 calls again every five minutes, the same way the
 * vault's backfill resumes from `backfill_after_path`.
 *
 * Every note gets a row saying what happened to it, so a finished sweep can
 * say how many notes were read and why the rest were not. A note is marked
 * `reading` before anything is sent, so a call killed partway through leaves
 * a row the next call turns into a failure, rather than a note that is
 * retried on every call and never finishes.
 *
 * Each note goes through proposeNoteMap, whose whyNotRead guard stays the one
 * that decides, and then straight into acceptNoteMap. The sweep does not wait
 * for a person to accept each note: KNOWLEDGE-SPEC.md puts review after the
 * merge pass, on the written map (build order step 6).
 *
 * Nothing here touches the database or a model. The ports do, so the runner
 * can be tested with a fake clock and a fake vault.
 */

/** Notes planned per batch. The clock is checked between batches. */
export const SWEEP_BATCH = 6;

/** Notes read at once inside a batch. Each reads up to four sections at once. */
export const NOTES_AT_ONCE = 2;

export const SWEEP_OUTCOMES = [
  'reading',
  'read',
  'unchanged',
  'journal',
  'credential',
  'too_short',
  'record',
  'nothing',
  'failed',
] as const;

export type SweepOutcome = (typeof SWEEP_OUTCOMES)[number];

/** Outcomes that mean nothing was sent to a model for this note. */
export const NEVER_SENT: readonly SweepOutcome[] = ['unchanged', 'journal', 'credential', 'too_short'];

export type SweepNoteRow = {
  noteId: string;
  blobSha: string;
  outcome: SweepOutcome;
  detail: string | null;
  themes: number;
  positions: number;
  newPositions: number;
  skipped: NoteSkip[];
  failedChunks: { title: string; detail: string }[];
};

export type SweepPorts = {
  /** Live notes after `afterPath` in path order, at most `limit`. */
  notesAfter(afterPath: string | null, limit: number): Promise<MapNote[]>;
  /** Which of these notes already have a row in this sweep. */
  reachedInSweep(noteIds: string[]): Promise<Set<string>>;
  /** For each note, the version an earlier sweep settled, if any. */
  settledVersions(noteIds: string[]): Promise<Map<string, string>>;
  /** The person's theme names, strongest first. */
  themeNames(): Promise<string[]>;
  propose(note: MapNote, existingThemes: string[]): Promise<ProposeResult>;
  accept(proposal: NoteMapProposal): Promise<AcceptResult>;
  /** Write or replace this note's row in the sweep. */
  record(row: SweepNoteRow): Promise<void>;
  saveProgress(afterPath: string): Promise<void>;
  /** False once the person has stopped the sweep. */
  stillRunning(): Promise<boolean>;
  /** Called after each batch is saved, e.g. to write the spend it made. */
  afterBatch?(): Promise<void>;
  now?(): number;
};

export type SliceResult = {
  /** Notes given a row by this call. */
  reached: number;
  afterPath: string | null;
  /** Every note has been reached. */
  finished: boolean;
  /** The person stopped the sweep while this call was working it. */
  stopped: boolean;
};

function row(note: MapNote, outcome: SweepOutcome, detail: string | null): SweepNoteRow {
  return {
    noteId: note.id,
    blobSha: note.blobSha,
    outcome,
    detail,
    themes: 0,
    positions: 0,
    newPositions: 0,
    skipped: [],
    failedChunks: [],
  };
}

/**
 * The answer for a note that is not sent at all, or null when it should be.
 *
 * whyNotRead runs again inside proposeNoteMap; it is asked here first so that
 * a journal is counted as a journal and not as a note too short to read.
 */
export function beforeRead(note: MapNote, settledSha: string | undefined): SweepNoteRow | null {
  const notRead = whyNotRead(note);
  if (notRead) return row(note, notRead.reason, notRead.detail);
  if (tooShortForMap(note.body)) {
    return row(note, 'too_short', 'Not read: under 80 characters.');
  }
  if (settledSha === note.blobSha) {
    return row(note, 'unchanged', 'Not read again: unchanged since an earlier sweep.');
  }
  return null;
}

/** The row for a proposal that did not come back with anything to write. */
export function refusedRow(note: MapNote, result: Exclude<ProposeResult, { ok: true }>): SweepNoteRow {
  switch (result.reason) {
    case 'not-read':
      return row(note, result.notRead.reason, result.notRead.detail);
    case 'operational':
      return row(note, 'record', result.detail);
    case 'nothing-in-it':
      return row(note, 'nothing', result.detail);
    case 'error':
      return row(note, 'failed', result.detail);
  }
}

/** The row once the proposal has been handed to acceptNoteMap. */
export function acceptedRow(
  note: MapNote,
  proposal: NoteMapProposal,
  accepted: AcceptResult,
): SweepNoteRow {
  const base = {
    ...row(note, 'read', null),
    skipped: proposal.skipped,
    failedChunks: proposal.chunks.failed,
  };
  if (!accepted.ok) return { ...base, outcome: 'failed', detail: accepted.detail };
  return {
    ...base,
    themes: accepted.themes,
    positions: accepted.positions,
    newPositions: accepted.newPositions,
  };
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

async function sweepOne(
  ports: SweepPorts,
  note: MapNote,
  settledSha: string | undefined,
  themes: () => Promise<string[]>,
): Promise<SweepNoteRow> {
  const early = beforeRead(note, settledSha);
  if (early) return early;

  await ports.record(row(note, 'reading', null));

  let result: ProposeResult;
  try {
    result = await ports.propose(note, await themes());
  } catch (error) {
    return row(note, 'failed', message(error, 'Reading the note failed.'));
  }
  if (!result.ok) return refusedRow(note, result);

  let accepted: AcceptResult;
  try {
    accepted = await ports.accept(result.proposal);
  } catch (error) {
    accepted = { ok: false, reason: 'error', detail: message(error, 'Writing the map failed.') };
  }
  return acceptedRow(note, result.proposal, accepted);
}

/** `run` over every item, `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Work the sweep from `afterPath` until the budget runs out, the vault runs
 * out, or the person stops it.
 */
export async function runSweepSlice(opts: {
  afterPath: string | null;
  ports: SweepPorts;
  budgetMs: number;
}): Promise<SliceResult> {
  const { ports } = opts;
  const now = ports.now ?? (() => Date.now());
  const deadline = now() + opts.budgetMs;

  let afterPath = opts.afterPath;
  let reached = 0;
  let slowestBatchMs = 0;

  for (;;) {
    if (!canStartAnotherBatch({ remainingMs: deadline - now(), slowestBatchMs })) {
      return { reached, afterPath, finished: false, stopped: false };
    }
    if (!(await ports.stillRunning())) {
      return { reached, afterPath, finished: false, stopped: true };
    }

    const startedAt = now();
    const notes = await ports.notesAfter(afterPath, SWEEP_BATCH);
    if (notes.length === 0) return { reached, afterPath, finished: true, stopped: false };

    const already = await ports.reachedInSweep(notes.map((note) => note.id));
    const todo = notes.filter((note) => !already.has(note.id));
    const settled = await ports.settledVersions(todo.map((note) => note.id));

    // Loaded once per batch and only when a note is sent, so the names grow
    // as the sweep writes themes and a batch of journals costs no query.
    let names: Promise<string[]> | null = null;
    const themes = () => (names ??= ports.themeNames());

    await inBatches(todo, NOTES_AT_ONCE, async (note) => {
      await ports.record(await sweepOne(ports, note, settled.get(note.id), themes));
      reached += 1;
    });

    afterPath = notes[notes.length - 1].path;
    await ports.saveProgress(afterPath);
    await ports.afterBatch?.();
    slowestBatchMs = Math.max(slowestBatchMs, now() - startedAt);
  }
}
