import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DigestEvent,
  DigestEventKind,
  DigestFeature,
  DigestPointer,
  DigestPointerKind,
} from '@/lib/digest/build';

/**
 * The morning summary, read for the top of /dev/raised.
 *
 * One row per day, written by the daily cron. The page reads the newest one
 * and shows the date it covers rather than saying "today": a cron that failed
 * overnight should leave yesterday's summary on the screen with yesterday's
 * date on it, not a fresh-looking one built from whatever is true right now.
 */

export type Digest = {
  id: string;
  /** The day it covers, `YYYY-MM-DD`, UTC. */
  day: string;
  /** The start of the window it read. */
  since: string;
  /**
   * Two or three sentences on what the day amounted to. Null on a day the
   * model call did not happen, and on every summary written before #442.
   */
  summary: string | null;
  happened: DigestEvent[];
  attention: DigestPointer[];
  createdAt: string;
};

const EVENT_KINDS: readonly DigestEventKind[] = ['step', 'note', 'decision'];
const POINTER_KINDS: readonly DigestPointerKind[] = ['decision', 'ready', 'suggestion'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * The feature an event closed under, where an older row has none. Read as
 * defensively as everything else here: a summary that lost its grouping still
 * renders, just flat.
 */
function featureFrom(value: unknown): DigestFeature | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const ref = text(row.ref);
  const title = text(row.title);
  return ref && title ? { ref, title } : null;
}

/**
 * Each entry read on its own, and a malformed one dropped.
 *
 * The column is jsonb, so nothing in the database says what an entry looks
 * like. An older deploy's shape must cost one missing row rather than the
 * whole page.
 */
function eventsFrom(value: unknown): DigestEvent[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const kind = row.kind as DigestEventKind;
    const title = text(row.title);
    if (!title || !EVENT_KINDS.includes(kind)) return [];
    return [
      {
        kind,
        title,
        ref: text(row.ref),
        commit: text(row.commit),
        note: text(row.note),
        at: text(row.at) ?? '',
        feature: featureFrom(row.feature),
      },
    ];
  });
}

function pointersFrom(value: unknown): DigestPointer[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const kind = row.kind as DigestPointerKind;
    const title = text(row.title);
    if (!title || !POINTER_KINDS.includes(kind)) return [];
    return [{ kind, title, ref: text(row.ref), detail: text(row.detail) }];
  });
}

export function digestFromRow(row: Record<string, unknown>): Digest {
  return {
    id: row.id as string,
    day: String(row.day ?? '').slice(0, 10),
    since: String(row.since ?? ''),
    summary: text(row.summary),
    happened: eventsFrom(row.happened),
    attention: pointersFrom(row.attention),
    createdAt: String(row.created_at ?? ''),
  };
}

/** Takes a client rather than building one, like everything else in lib/. */
export async function loadDigest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<Digest | null> {
  const { data } = await supabase
    .from('dev_digests')
    .select('id, day, since, summary, happened, attention, created_at')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? digestFromRow(data as unknown as Record<string, unknown>) : null;
}
