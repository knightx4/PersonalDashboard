import type { KnowledgeState } from '@/lib/learn/graph/model';
import type { StrengthInput } from '@/lib/learn/strength';
import { lightOn, type Light, type LightInput } from './sky';

/**
 * Replaying how Idea Space grew (plan #1997.8), apart from the page so it can
 * be tested without a browser.
 *
 * The timeline runs in whole days from the day of the first idea to today. On
 * any day an idea is on the map once it was written (`createdAt`), and lit
 * once its state was set: the day it was tested, or the day you said you knew
 * it. Before that it is an idea not known yet. An idea whose state carries no
 * date (taken from an idea above it) lights the day it was written.
 *
 * Only the state row as it stands today is kept, so the past is that row with
 * its dates honoured: an idea declared and then tested shows as declared
 * between the two. Its level is today's throughout, since no history of
 * levels is stored.
 */

export const DAY_MS = 86_400_000;

export type TimelineIdea = LightInput & {
  /** When the idea was written, as an ISO string, or null when not known. */
  createdAt: string | null;
};

/** One idea as the map stood on a day: its light, and its state then. */
export type LightThen = Light & { state: KnowledgeState; stateRow: StrengthInput | null };

/** Midnight UTC at the start of the day `t` falls in. */
function dayStart(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

function time(value: string | Date | null): number | null {
  if (value === null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * The days the timeline runs over: from the start of the first idea's day to
 * `today`, as a count of steps after the first. `days` is 0 when every idea is
 * from today, and the timeline then has nothing to replay.
 */
export function timelineSpan(ideas: readonly Pick<TimelineIdea, 'createdAt'>[], today: Date): { start: number; days: number } {
  let first = Infinity;
  for (const idea of ideas) {
    const t = time(idea.createdAt);
    if (t !== null && t < first) first = t;
  }
  const end = today.getTime();
  const start = dayStart(Math.min(Number.isFinite(first) ? first : end, end));
  return { start, days: Math.round((dayStart(end) - start) / DAY_MS) };
}

/**
 * The moment step `day` of the timeline stands for: the end of that day, so an
 * idea written at any time on it is on the map, and never later than today.
 */
export function momentOf(span: { start: number; days: number }, day: number, today: Date): Date {
  if (day >= span.days) return today;
  return new Date(Math.min(span.start + (day + 1) * DAY_MS - 1, today.getTime()));
}

/** The state row as it stood on `on`, or null when nothing had been set yet. */
export function stateRowOn(row: StrengthInput | null, createdAt: string | null, on: Date): StrengthInput | null {
  if (!row || row.state === 'unknown') return row;
  const t = on.getTime();
  const tested = time(row.tested_at);
  const declared = time(row.declared_at);
  if (tested !== null && tested <= t) return row;
  if (declared !== null && declared <= t) {
    return tested === null ? row : { ...row, established: 'declared', tested_at: null };
  }
  if (tested === null && declared === null) {
    // No date of its own: it lights with the idea.
    const born = time(createdAt);
    return born === null || born <= t ? row : null;
  }
  return null;
}

/**
 * Every idea on the map on `on`, lit as it was then. An idea written later is
 * left out of the map returned, and gives no haze to its neighbours.
 */
export function mapOn(ideas: readonly TimelineIdea[], on: Date): Map<string, LightThen> {
  const t = on.getTime();
  const present = ideas.filter((idea) => {
    const born = time(idea.createdAt);
    return born === null || born <= t;
  });
  const rows = new Map(present.map((idea) => [idea.id, stateRowOn(idea.stateRow, idea.createdAt, on)]));
  const light = lightOn(
    present.map((idea) => ({ id: idea.id, stateRow: rows.get(idea.id) ?? null, neighbours: idea.neighbours })),
    on,
  );
  const out = new Map<string, LightThen>();
  for (const idea of present) {
    const row = rows.get(idea.id) ?? null;
    out.set(idea.id, { ...light.get(idea.id)!, state: row?.state ?? 'unknown', stateRow: row });
  }
  return out;
}

export type DayCounts = {
  /** Ideas on the map. */
  ideas: number;
  /** Ideas with any strength. */
  lit: number;
  /** The mean strength over the ideas on the map, from 0 to 1. */
  averageStrength: number;
};

/** The counts the timeline's line gives for a day. */
export function countsOf(lights: Iterable<{ strength: number }>): DayCounts {
  let ideas = 0;
  let lit = 0;
  let sum = 0;
  for (const light of lights) {
    ideas += 1;
    if (light.strength > 0) lit += 1;
    sum += light.strength;
  }
  return { ideas, lit, averageStrength: ideas > 0 ? sum / ideas : 0 };
}
