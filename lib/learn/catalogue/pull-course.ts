import type { EmbedSweepResult } from './embed-sweep';
import { embedAfterPull, type EmbeddingReport } from './pull';
import type { CourseSweepResult } from './sweep';

/**
 * Pulling a lecture course into the catalogue from the app.
 *
 * What `npm run catalogue -- --course <playlist> --embed` does, in one press
 * of the course form on a subject page: store the course and its lectures in
 * published order, cut each lecture into timed segments, then embed. This
 * module is the part a test can reach. The sweep and the embedding pass come
 * in as ports, and every way it can go wrong comes back as a line in the
 * report rather than as a throw.
 */

/**
 * When a press stops looking up transcripts, counted from when it started.
 *
 * The subject page allows 300 seconds. A thirty-lecture MIT course is about
 * sixty fetches from ocw.mit.edu, which normally takes well under this. The
 * rest is kept for storing the course and for the embedding pass, because a
 * lookup already running when the mark passes can take up to two 15-second
 * fetch timeouts to finish.
 */
export const TRANSCRIPT_BUDGET_MS = 180_000;

/**
 * When a press stops starting new embedding calls, counted the same way. The
 * margin after it is for the call still in flight and the ledger writes.
 */
export const EMBED_BUDGET_MS = 255_000;

export type ParsedPlaylist = { ok: true; playlistId: string } | { ok: false; error: string };

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * A playlist id as typed, or read out of a pasted YouTube link's `list=`.
 */
export function parsePlaylistId(raw: string): ParsedPlaylist {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Paste a YouTube playlist id or a link to the playlist.' };

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let list: string | null = null;
    try {
      list = new URL(trimmed).searchParams.get('list');
    } catch {
      list = null;
    }
    if (!list) return { ok: false, error: 'That link has no playlist in it. Look for list= in the address.' };
    candidate = list;
  }

  if (!PLAYLIST_ID.test(candidate)) {
    return { ok: false, error: `${candidate} does not look like a YouTube playlist id.` };
  }
  return { ok: true, playlistId: candidate };
}

export type PulledCourse =
  | {
      ok: true;
      title: string;
      /** Lectures in the course, in published order. */
      videos: number;
      /** Lectures cut this press, by how. */
      cutBy: { transcript: number; chapters: number; whole: number };
      /** Lectures left as an earlier press cut them from a transcript. */
      kept: number;
      /** Lectures whose transcript was not looked for because time ran out. */
      notReached: number;
      segments: number;
      removed: number;
      /** Pages ocw.mit.edu would not hand over, first few only. */
      refused: string[];
      refusedCount: number;
    }
  | { ok: false; reason: string; detail: string };

export type CoursePullReport = {
  course: PulledCourse;
  /** Null when nothing was stored, so the pass did not run. */
  embedding: EmbeddingReport | null;
};

export type CoursePullPorts = {
  sweep(): Promise<CourseSweepResult>;
  embed(limit: number): Promise<EmbedSweepResult>;
};

/** How many refusal lines the report carries. The count carries the rest. */
const REFUSALS_SHOWN = 3;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pullCourse(ports: CoursePullPorts): Promise<CoursePullReport> {
  let swept: CourseSweepResult;
  try {
    swept = await ports.sweep();
  } catch (error) {
    return { course: { ok: false, reason: 'store', detail: message(error) }, embedding: null };
  }

  if (!swept.ok) {
    return { course: { ok: false, reason: swept.reason, detail: swept.detail }, embedding: null };
  }

  return {
    course: {
      ok: true,
      title: swept.title,
      videos: swept.videos,
      cutBy: swept.cutBy,
      kept: swept.kept,
      notReached: swept.notReached,
      segments: swept.written,
      removed: swept.removed,
      refused: swept.refused.slice(0, REFUSALS_SHOWN),
      refusedCount: swept.refused.length,
    },
    embedding: await embedAfterPull(ports.embed),
  };
}
