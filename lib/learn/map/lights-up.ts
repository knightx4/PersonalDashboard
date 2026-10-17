import type { KnowledgeState } from '@/lib/learn/graph/model';
import { stateSetAt, type StrengthInput } from '@/lib/learn/strength';
import type { LightThen } from './timeline';

/**
 * The moment "An idea lights up" on Idea Space (plan #1997.10), apart from
 * the page so it can be tested without a browser.
 *
 * Nothing records when the person last opened the map, so "since you were
 * last here" is stood in for by a fixed window: the ideas whose state was set
 * in the last two days and that have tested strength, since only an answer
 * lights a star (plan #2187.1). The map plays the
 * newest few of them on arrival, brightening each star from dark to its
 * strength, and names them under the map.
 */

/** How far back a state counts as just set. */
export const LIT_WINDOW_DAYS = 2;
/** The most stars that brighten at once, so the sky shows a few lights and not a flicker. */
export const LIT_AT_ONCE = 3;
/** Wait before the stars start, so the sky has drawn first. */
export const LIT_DELAY_MS = 150;
/** How long each star takes to brighten: done within the first second of the map. */
export const LIT_MS = 600;

const DAY_MS = 86_400_000;

type Lit = {
  id: string;
  strength: number;
  haze: number;
  exposure: number;
  state: KnowledgeState;
  stateRow: StrengthInput | null;
};

/** The ideas lit in the last two days with any strength, newest first, at most `LIT_AT_ONCE`. */
export function recentlyLit<T extends Pick<Lit, 'id' | 'strength' | 'stateRow'>>(ideas: readonly T[], now: Date): T[] {
  const since = now.getTime() - LIT_WINDOW_DAYS * DAY_MS;
  return ideas
    .flatMap((idea) => {
      const set = idea.stateRow ? stateSetAt(idea.stateRow) : null;
      const at = set?.getTime() ?? null;
      return at !== null && at >= since && at <= now.getTime() && idea.strength > 0 ? [{ idea, at }] : [];
    })
    .sort((a, b) => b.at - a.at || a.idea.id.localeCompare(b.idea.id))
    .slice(0, LIT_AT_ONCE)
    .map(({ idea }) => idea);
}

/** Quick at first and settling, so a star seems to catch. */
export function ease(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  return 1 - (1 - p) * (1 - p) * (1 - p);
}

/**
 * The map with the ideas in `ids` part-way lit: each has `progress` of its
 * strength, every other idea is as it stands. Handed to the sky as `replay`,
 * which relights the same stars, so nothing moves.
 */
export function lightingUp(ideas: readonly Lit[], ids: ReadonlySet<string>, progress: number): Map<string, LightThen> {
  const share = ease(progress);
  const out = new Map<string, LightThen>();
  for (const idea of ideas) {
    out.set(idea.id, {
      strength: ids.has(idea.id) ? idea.strength * share : idea.strength,
      haze: idea.haze,
      exposure: idea.exposure,
      state: idea.state,
      stateRow: idea.stateRow,
    });
  }
  return out;
}

/** The line under the map naming what lit, or null when nothing did. */
export function litLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const quoted = names.map((name) => `“${name}”`);
  const list = quoted.length === 1 ? quoted[0]! : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
  return `${list} lit in the last two days.`;
}
