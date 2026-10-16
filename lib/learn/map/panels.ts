import { ladderLevel } from '@/lib/learn/levels/ladder';
import {
  cellsUnder,
  fringe,
  isHeld,
  readCells,
  topicLevel,
  type LensTarget,
  type Readings,
  type TopicMap,
} from '@/lib/learn/levels/model';
import { halvesOn, stateSetAt, type StrengthInput } from '@/lib/learn/strength';
import type { StateBasis } from '@/lib/learn/graph/model';

/**
 * The three panels under Idea Space's map (plan #2187.6): the ideas whose
 * strength halves soonest, the open rungs under one performance of a goal you
 * cannot do yet, and one goal's levels on two dates side by side.
 *
 * Pure. The fade panel reads each idea's state row and the memory curve
 * (`halvesOn`, lib/learn/strength.ts). The other two read the topic map the
 * goals were drawn from, its cells, links and cell_evidence, and work the
 * readings out again for any day by leaving out the evidence after it
 * (rule R4: nothing is stored, so the earlier picture is the same rules on
 * less evidence). No new table.
 */

export const PANELS = ['fade', 'gaps', 'then'] as const;
export type Panel = (typeof PANELS)[number];

export function isPanel(value: string | null | undefined): value is Panel {
  return (PANELS as readonly string[]).includes(value ?? '');
}

/** What the page sends the browser for the two goal panels: the topic map and each goal's targets. */
export type GoalLevels = {
  map: TopicMap;
  lenses: { id: string; name: string; targets: LensTarget[] }[];
};

const DAY_MS = 86_400_000;

/** The fade tab's count: ideas that halve within this many days. */
export const FADE_SOON_DAYS = 7;

// -- What will fade ------------------------------------------------------------

export type FadingIdea = {
  id: string;
  name: string;
  /** The day its strength next halves, as an ISO string. */
  halvesOn: string;
  /** Whole days from `asOf` to then, 0 for later today. */
  inDays: number;
  /** The day the state was set, which the halving runs from. */
  setAt: string;
  established: StateBasis;
  /** The subject it was written under, which Practice Flow narrows to. */
  trackId: string | null;
};

type FadeInput = { id: string; name: string; stateRow: StrengthInput | null; track: { id: string } | null };

/**
 * Every idea that fades, soonest to halve first, the longer-held breaking a
 * tie, then by name. `only` keeps to a chosen goal's ideas.
 */
export function fadingIdeas(ideas: readonly FadeInput[], asOf: Date, only?: ReadonlySet<string> | null): FadingIdea[] {
  const out: FadingIdea[] = [];
  for (const idea of ideas) {
    if (only && !only.has(idea.id)) continue;
    const row = idea.stateRow;
    if (!row) continue;
    const next = halvesOn(row, asOf);
    const set = stateSetAt(row);
    if (!next || !set) continue;
    out.push({
      id: idea.id,
      name: idea.name,
      halvesOn: next.toISOString(),
      inDays: Math.max(0, Math.floor((next.getTime() - asOf.getTime()) / DAY_MS)),
      setAt: set.toISOString(),
      established: row.established,
      trackId: idea.track?.id ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      a.halvesOn.localeCompare(b.halvesOn) || a.setAt.localeCompare(b.setAt) || a.name.localeCompare(b.name),
  );
}

// -- The gaps under a performance ----------------------------------------------

export type Rung = {
  cellId: string;
  topicId: string;
  topicName: string;
  level: number;
  /** What you can do at the level, from the ladder. */
  can: string;
  status: 'open' | 'missed';
  /** Everything it needs is held, so Practice can ask it now. */
  ready: boolean;
};

/** A performance: one topic of a goal at its target level, and what stands open beneath it. */
export type Performance = {
  topicId: string;
  name: string;
  /** The goal's target on the topic, the level the performance is. */
  level: number;
  can: string;
  /** The level held on the topic now. */
  held: number;
  approved: boolean;
  /** The cells the performance needs that are not held, the performance itself included, lowest first. */
  rungs: Rung[];
};

/**
 * Each target of a goal you cannot do yet, as a performance with its open
 * rungs, fewest open first so the nearest is on top, then by name.
 */
export function performances(levels: GoalLevels, readings: Readings, lensId: string): Performance[] {
  const lens = levels.lenses.find((l) => l.id === lensId);
  if (!lens) return [];
  const { map } = levels;
  const topicOf = new Map(map.topics.map((t) => [t.id, t]));
  const cellAt = new Map(map.cells.map((cell) => [`${cell.topicId}:${cell.level}`, cell]));
  const ready = new Set(fringe(map, readings).map((row) => row.cellId));

  const out: Performance[] = [];
  for (const target of lens.targets) {
    const topic = topicOf.get(target.topicId);
    if (!topic) continue;
    const level = Math.min(target.targetLevel, topic.ceiling);
    const cell = level > 0 ? cellAt.get(`${topic.id}:${level}`) : undefined;
    if (!cell) continue;
    const held = topicLevel(map, readings, topic.id).level;
    if (held >= level) continue;
    const under = cellsUnder(map, cell.id);
    const rungs: Rung[] = [];
    for (const id of under) {
      const reading = readings.get(id);
      if (!reading || isHeld(reading.status)) continue;
      rungs.push({
        cellId: id,
        topicId: reading.topicId,
        topicName: topicOf.get(reading.topicId)?.name ?? 'A topic',
        level: reading.level,
        can: ladderLevel(reading.level).can,
        status: reading.status === 'missed' ? 'missed' : 'open',
        ready: ready.has(id),
      });
    }
    // The performance's own topic first, then the others it needs, each lowest first.
    rungs.sort(
      (a, b) =>
        Number(b.topicId === topic.id) - Number(a.topicId === topic.id) ||
        a.topicName.localeCompare(b.topicName) ||
        a.level - b.level,
    );
    out.push({
      topicId: topic.id,
      name: topic.name,
      level,
      can: ladderLevel(level).can,
      held,
      approved: topic.approved,
      rungs,
    });
  }
  return out.sort((a, b) => a.rungs.length - b.rungs.length || a.name.localeCompare(b.name));
}

/** The performance the panel shows: the topic open in the address when it is one, else the nearest. */
export function chosenPerformance(list: readonly Performance[], topicId: string | null): Performance | null {
  return (topicId ? list.find((p) => p.topicId === topicId) : undefined) ?? list[0] ?? null;
}

// -- Then and now --------------------------------------------------------------

/** The map's readings as they stood at the end of `day`: the same rules on the evidence up to it. */
export function readingsOn(map: TopicMap, day: Date): Readings {
  const until = day.toISOString();
  return readCells({ ...map, evidence: map.evidence.filter((row) => row.observedAt <= until) });
}

export type ThenNowRow = {
  topicId: string;
  name: string;
  target: number;
  approved: boolean;
  then: number;
  now: number;
};

export type ThenAndNow = {
  rows: ThenNowRow[];
  /** Levels held at or under the targets, on each day. */
  heldThen: number;
  heldNow: number;
  /** Levels under the targets in all. */
  total: number;
};

/** A goal's topics on two days: the level held on each and the levels held under the targets. */
export function thenAndNow(levels: GoalLevels, lensId: string, then: Date, now: Date): ThenAndNow | null {
  const lens = levels.lenses.find((l) => l.id === lensId);
  if (!lens) return null;
  const { map } = levels;
  const before = readingsOn(map, then);
  const after = readingsOn(map, now);
  const topicOf = new Map(map.topics.map((t) => [t.id, t]));
  const heldUnder = (readings: Readings, topicId: string, target: number) => {
    let n = 0;
    for (const r of readings.values()) if (r.topicId === topicId && r.level <= target && isHeld(r.status)) n += 1;
    return n;
  };

  const rows: ThenNowRow[] = [];
  let heldThen = 0;
  let heldNow = 0;
  let total = 0;
  for (const t of lens.targets) {
    const topic = topicOf.get(t.topicId);
    if (!topic) continue;
    const target = Math.min(t.targetLevel, topic.ceiling);
    rows.push({
      topicId: topic.id,
      name: topic.name,
      target,
      approved: topic.approved,
      then: topicLevel(map, before, topic.id).level,
      now: topicLevel(map, after, topic.id).level,
    });
    heldThen += heldUnder(before, topic.id, target);
    heldNow += heldUnder(after, topic.id, target);
    total += map.cells.filter((cell) => cell.topicId === topic.id && cell.level <= target).length;
  }
  // What moved first, most first, then by name.
  rows.sort((a, b) => b.now - b.then - (a.now - a.then) || b.now - a.now || a.name.localeCompare(b.name));
  return { rows, heldThen, heldNow, total };
}

/** The earlier day the panel opens on: four weeks before today. */
export const THEN_DAYS_BACK = 28;

/** A `YYYY-MM-DD` day in the address, read as the end of that day in UTC, or null when it is not one. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The day `days` before `asOf`, as `YYYY-MM-DD`. */
export function dayBefore(asOf: Date, days: number): string {
  return new Date(asOf.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}
