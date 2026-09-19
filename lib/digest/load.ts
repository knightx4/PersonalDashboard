import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DigestEvent,
  DigestEventKind,
  DigestFeature,
  DigestPointer,
  DigestPointerKind,
} from '@/lib/digest/build';
import type { DigestNight, DigestNightRef, DigestNightStep } from '@/lib/digest/night';
import { isModuleId, type ModuleId } from '@/lib/modules';

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
  /**
   * How many ideas the overnight run filed on the ideas page in the window
   * this summary covers. Zero on a night that filed none, and on every
   * summary written before the column existed.
   */
  ideasFiled: number;
  /**
   * What the overnight runner did, on a day it did anything. Null on every
   * ordinary day and on every summary written before #585.
   */
  night: DigestNight | null;
  createdAt: string;
};

const EVENT_KINDS: readonly DigestEventKind[] = ['step', 'note', 'decision'];
const POINTER_KINDS: readonly DigestPointerKind[] = ['decision', 'ready', 'suggestion'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * A whole count, and zero for anything that is not one. A row written before
 * the column existed reads back as none filed, which is what the page draws
 * nothing for -- the same as a night that filed none, and the same as the
 * truth in both cases.
 */
function countFrom(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
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

/** A workspace this deploy still knows about, or nothing. */
function moduleFrom(value: unknown): ModuleId | null {
  return typeof value === 'string' && isModuleId(value) ? value : null;
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
        // Absent on every summary written before the field existed, and on a
        // row that belonged to the app as a whole. Both read back as null.
        module: moduleFrom(row.module),
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

/** One named row of the night's report, or nothing if it lost its name. */
function nightRefFrom(value: unknown): DigestNightRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const ref = text(row.ref);
  const title = text(row.title);
  return ref && title ? { ref, title } : null;
}

function nightStepsFrom(value: unknown): DigestNightStep[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((entry) => {
    const named = nightRefFrom(entry);
    if (!named) return [];
    const row = entry as Record<string, unknown>;
    return [{ ...named, feature: nightRefFrom(row.feature), ask: text(row.ask) }];
  });
}

/**
 * The night, read as defensively as everything else on this row.
 *
 * The state and the start are what the block cannot be drawn without: a night
 * with no word for what it was doing, or no window it covered, is not a report
 * and is dropped whole. Everything under it degrades to a shorter list rather
 * than to nothing.
 *
 * `off` is not read back even if something wrote it. It means there was no
 * night, and a block saying so is a paragraph about nothing having happened.
 */
function nightFrom(value: unknown): DigestNight | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;

  const standing = text(row.standing);
  const startedAt = text(row.startedAt);
  if (!startedAt) return null;
  if (standing !== 'running' && standing !== 'paused' && standing !== 'stopped') return null;

  const count = (input: unknown): number => {
    const value = Number(input ?? 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  return {
    standing,
    startedAt,
    endedAt: text(row.endedAt),
    endedReason: text(row.endedReason),
    featuresBudget: row.featuresBudget == null ? null : count(row.featuresBudget),
    featuresLeft: row.featuresLeft == null ? null : count(row.featuresLeft),
    features: (Array.isArray(row.features) ? (row.features as unknown[]) : []).flatMap((entry) => {
      const named = nightRefFrom(entry);
      const at = text((entry as Record<string, unknown>)?.at);
      return named ? [{ ...named, at: at ?? '' }] : [];
    }),
    // Absent on every night stored before #633, which is why it degrades to
    // null rather than to the last of `features`: the report has no use for it
    // -- by breakfast there is no feature being built -- and a guess at which
    // one it was would be a fact nobody wrote down.
    lastFire: (() => {
      const named = nightRefFrom(row.lastFire);
      const at = text((row.lastFire as Record<string, unknown> | null)?.at);
      return named ? { ...named, at: at ?? '' } : null;
    })(),
    closed: nightStepsFrom(row.closed),
    blocked: nightStepsFrom(row.blocked),
  };
}

export function digestFromRow(row: Record<string, unknown>): Digest {
  return {
    id: row.id as string,
    day: String(row.day ?? '').slice(0, 10),
    since: String(row.since ?? ''),
    summary: text(row.summary),
    happened: eventsFrom(row.happened),
    attention: pointersFrom(row.attention),
    ideasFiled: countFrom(row.ideas_filed),
    night: nightFrom(row.night),
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
    .select('id, day, since, summary, happened, attention, ideas_filed, night, created_at')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? digestFromRow(data as unknown as Record<string, unknown>) : null;
}
