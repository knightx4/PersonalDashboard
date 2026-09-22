import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What the notes routine did the last time it ran, for the Status panel.
 *
 * The routine keeps no record of its own runs. It claims a note, then closes
 * it as done or declined, or leaves it blocked, and those rows are all there
 * is to read. So a run is inferred: the newest note it finished, plus every
 * other note finished in the hours before that one. A batch takes minutes to
 * an hour, so three hours holds a whole run without reaching back into the
 * one before.
 *
 * The cost of inferring it: a note you closed yourself inside that window is
 * counted as the routine's. Nothing on the row says who closed it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/** How far back from the newest finished note a run is read. */
export const NOTES_RUN_WINDOW_MS = 3 * 60 * 60 * 1000;

/** A note as this reads it: how it ended, and when. */
export type FinishedNote = {
  status: 'done' | 'declined' | 'blocked';
  /** `completed_at` for a closed note, `updated_at` for a blocked one. */
  at: string;
};

export type NotesLastRun = {
  /** When the newest note in the run was finished. */
  at: string;
  done: number;
  declined: number;
  blocked: number;
};

/** The last run, or null when no note has ever been finished. */
export function notesLastRun(notes: readonly FinishedNote[]): NotesLastRun | null {
  const timed = notes
    .map((note) => ({ ...note, ms: new Date(note.at).getTime() }))
    .filter((note) => Number.isFinite(note.ms));
  if (timed.length === 0) return null;

  const newest = Math.max(...timed.map((note) => note.ms));
  const run = timed.filter((note) => note.ms > newest - NOTES_RUN_WINDOW_MS);
  const count = (status: FinishedNote['status']) =>
    run.filter((note) => note.status === status).length;

  return {
    at: new Date(newest).toISOString(),
    done: count('done'),
    declined: count('declined'),
    blocked: count('blocked'),
  };
}

/** The run as one line: "4 fixed, 1 declined, 1 blocked". */
export function notesLastRunLine(run: NotesLastRun): string {
  const parts = [
    run.done > 0 && `${run.done} fixed`,
    run.declined > 0 && `${run.declined} declined`,
    run.blocked > 0 && `${run.blocked} blocked`,
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Reads the notes finished in the last week and returns the newest run.
 *
 * A week bounds the read. A routine that has not closed a note in a week has
 * nothing recent to report, and the row says it has not run instead.
 */
export async function loadNotesLastRun(supabase: Db, userId: string): Promise<NotesLastRun | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [closed, blocked] = await Promise.all([
    supabase
      .from('feedback_items')
      .select('status, completed_at')
      .eq('user_id', userId)
      .in('status', ['done', 'declined'])
      .gte('completed_at', since),
    supabase
      .from('feedback_items')
      .select('status, updated_at')
      .eq('user_id', userId)
      .eq('status', 'blocked')
      .gte('updated_at', since),
  ]);

  const notes: FinishedNote[] = [
    ...(closed.data ?? []).map((row) => ({
      status: row.status as 'done' | 'declined',
      at: row.completed_at as string,
    })),
    ...(blocked.data ?? []).map((row) => ({
      status: 'blocked' as const,
      at: row.updated_at as string,
    })),
  ];
  return notesLastRun(notes);
}
