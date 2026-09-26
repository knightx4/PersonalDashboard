/**
 * Learning tracks suggested from the career goals: the shape the model reports
 * and the check that reads it (job_search.learning_tracks, 0027).
 *
 * Pure, so the page, the action and the tests can all import it.
 */

import { AIM_ABOUT_MAX, AIM_NAME_MAX, isAimDepth, type AimDepth } from '@/lib/learn/aims';

/** At most this many suggestions come back from one press. */
export const MAX_SUGGESTIONS = 5;

/** The longest `why` the table takes (learning_tracks_why_ck). */
export const WHY_MAX = 1000;

export type LearningTrackStatus = 'proposed' | 'started' | 'dismissed';

export type TrackSuggestion = {
  name: string;
  about: string | null;
  depth: AimDepth;
  why: string;
};

/** A suggestion waiting on an answer, as the Career goals page shows it. */
export type SuggestedTrackView = {
  id: string;
  name: string;
  about: string | null;
  depth: AimDepth;
  why: string;
};

/** A track started from the Career goals page. */
export type StartedTrackView = SuggestedTrackView & {
  /** The Learn track, once the goal has one. Null while it is being made. */
  subjectId: string | null;
  /** How many units its curriculum has so far. */
  units: number;
  /** The Learn goal has been archived or deleted since. */
  gone: boolean;
};

export type SuggestionResult =
  | { ok: true; suggestions: TrackSuggestion[] }
  | { ok: false; error: string };

/** The key two names share when they are the same track: case and spacing ignored. */
export function trackKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Read the tool input the model sent. Suggestions with no name or no reason
 * are dropped, a missing or unknown depth reads as familiar, and a name that
 * repeats one earlier in the list, or one in `taken`, is dropped.
 */
export function parseSuggestionPayload(
  input: unknown,
  taken: ReadonlySet<string> = new Set(),
): SuggestionResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'No suggestions came back.' };
  const raw = (input as { tracks?: unknown }).tracks;
  if (!Array.isArray(raw)) {
    if ((input as { no_data?: unknown }).no_data === true) return { ok: true, suggestions: [] };
    return { ok: false, error: 'No suggestions came back.' };
  }

  const seen = new Set(taken);
  const suggestions: TrackSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, about, depth, why } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof why !== 'string') continue;
    const cleanName = clip(name.trim().replace(/\s+/g, ' '), AIM_NAME_MAX);
    const cleanWhy = clip(why.trim(), WHY_MAX);
    if (!cleanName || !cleanWhy) continue;
    const key = trackKey(cleanName);
    if (seen.has(key)) continue;
    seen.add(key);
    const cleanAbout = typeof about === 'string' ? clip(about.trim(), AIM_ABOUT_MAX) : '';
    suggestions.push({
      name: cleanName,
      about: cleanAbout || null,
      depth: isAimDepth(depth) ? depth : 'familiar',
      why: cleanWhy,
    });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return { ok: true, suggestions };
}
