/**
 * Lenses as the pages show them (docs/LEARN-LEVELS-SPEC.md, "Lenses: subjects
 * and goals"; plan #2138.7).
 *
 * Pure: the rows come in from lib/learn/levels/lens-store.ts and the map from
 * loadTopicMap, and everything here is worked out on read (rule R4). Progress
 * is lensProgress from the model; this adds what the pages say around it:
 * how many topics sit in each band, the fringe inside the lens, the topics
 * added today, and each field's mean level for the Know page.
 */

import { BANDS, ladderLevel, type Band } from '@/lib/learn/levels/ladder';
import {
  fringe,
  lensProgress,
  topicLevel,
  type FringeRow,
  type LensProgress,
  type LensTarget,
  type Readings,
  type TopicMap,
} from '@/lib/learn/levels/model';

/**
 * The level a learning goal's depth asks for on each of its topics, never
 * above the topic's ceiling. learn 0137's goal_target_level has the same
 * three numbers, and the goal lens is filled with them.
 */
export const DEPTH_TARGET = { familiar: 2, solid: 5, deep: 8 } as const;

/** The target a topic gets when it is drafted from a subject's page: solid. */
export const SUBJECT_GOAL_TARGET = DEPTH_TARGET.solid;

export function goalTargetLevel(depth: string, ceiling: number): number {
  const wanted = DEPTH_TARGET[depth as keyof typeof DEPTH_TARGET] ?? DEPTH_TARGET.familiar;
  return Math.min(ceiling, wanted);
}

export type LensOrigin = 'subject' | 'goal' | 'theme';

/** One lens row with its targets, as the store reads them. */
export type LensRecord = {
  id: string;
  name: string;
  origin: LensOrigin;
  subjectId: string | null;
  aimId: string | null;
  createdAt: string;
  targets: ReadonlyArray<LensTarget & { addedAt: string }>;
};

/** A topic's name and whether it is approved, for the rows. */
export type TopicName = { id: string; name: string; approved: boolean; ceiling: number };

/** Where a topic's level sits: not placed yet, or one of the ladder's four bands. */
export type BandName = 'Unplaced' | Band;
export const BAND_ORDER: readonly BandName[] = ['Unplaced', ...BANDS];

export type BandCount = { band: BandName; topics: number };

/** How many approved topics sit in each band, in ladder order, empty bands kept. */
export function bandCounts(levels: readonly number[]): BandCount[] {
  const counts = new Map<BandName, number>(BAND_ORDER.map((b) => [b, 0]));
  for (const level of levels) {
    const band: BandName = level <= 0 ? 'Unplaced' : ladderLevel(Math.min(level, 10)).band;
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  return BAND_ORDER.map((band) => ({ band, topics: counts.get(band) ?? 0 }));
}

/** One lens on the Know page. */
export type LensSummary = {
  id: string;
  name: string;
  origin: LensOrigin;
  held: number;
  total: number;
  fraction: number;
  /** Approved topics on it. A draft is counted once approved. */
  topics: number;
  drafts: number;
};

function approvedTargets(lens: LensRecord, topics: ReadonlyMap<string, TopicName>) {
  return lens.targets.filter((t) => topics.get(t.topicId)?.approved);
}

export function summariseLens(
  lens: LensRecord,
  map: TopicMap,
  readings: Readings,
  topics: ReadonlyMap<string, TopicName>,
): LensSummary {
  const approved = approvedTargets(lens, topics);
  const progress = lensProgress(map, readings, approved);
  return {
    id: lens.id,
    name: lens.name,
    origin: lens.origin,
    held: progress.held,
    total: progress.total,
    fraction: progress.fraction,
    topics: approved.length,
    drafts: lens.targets.length - approved.length,
  };
}

/** The line a lens row carries after its name. */
export function lensLine(summary: LensSummary): string {
  if (summary.topics === 0) {
    return summary.drafts > 0
      ? `${summary.drafts === 1 ? 'A draft topic' : `${summary.drafts} draft topics`} to approve`
      : 'No topics yet';
  }
  const topics = summary.topics === 1 ? '1 topic' : `${summary.topics} topics`;
  return `${topics} · ${summary.held} of ${summary.total} levels held`;
}

/** One cell inside a lens that you are ready for, with why it is there. */
export type LensFringeCell = {
  cellId: string;
  level: number;
  band: Band;
  can: string;
  why: string;
};

export function fringeWhy(row: FringeRow, topicName: string): string {
  const opens = row.unlocks === 1 ? ', and opens 1 more level' : row.unlocks > 1 ? `, and opens ${row.unlocks} more levels` : '';
  if (row.status === 'missed') return `Missed before, and what it needs is held now${opens}.`;
  if (row.direction === 'deeper') return `The next level up on ${topicName}${opens}.`;
  return `What it needs is held, so ${topicName} can start here${opens}.`;
}

export type LensTopicView = {
  topicId: string;
  name: string;
  approved: boolean;
  ceiling: number;
  target: number;
  level: number;
  held: number;
  total: number;
  addedAt: string;
  /** Cells you are ready for at or below the target, lowest first. */
  fringe: LensFringeCell[];
};

export type LensDetailView = {
  progress: Pick<LensProgress, 'held' | 'total' | 'fraction'>;
  bands: BandCount[];
  /** Approved topics first by name, then drafts. */
  topics: LensTopicView[];
  /** Topics that joined today, which is why progress may have fallen. */
  addedToday: string[];
};

/**
 * Everything the lens page draws: progress over the approved topics, the
 * bands, each topic as a bar to its target with the fringe inside the lens,
 * and the topics added today. `today` is the account's day key
 * (zoneDay), and `dayOf` turns an instant into one.
 */
export function lensDetail(
  lens: LensRecord,
  map: TopicMap,
  readings: Readings,
  topics: ReadonlyMap<string, TopicName>,
  day: { today: string; dayOf: (at: string) => string },
): LensDetailView {
  const approved = approvedTargets(lens, topics);
  const progress = lensProgress(map, readings, approved);
  const byTopic = new Map(progress.topics.map((t) => [t.topicId, t]));
  const targets = new Map(approved.map((t) => [t.topicId, t.targetLevel]));
  const ready = fringe(map, readings, { lensTargets: targets }).filter((row) => row.inLens && targets.has(row.topicId));

  const views: LensTopicView[] = lens.targets.flatMap((target) => {
    const topic = topics.get(target.topicId);
    if (!topic) return [];
    const p = byTopic.get(target.topicId);
    return [
      {
        topicId: topic.id,
        name: topic.name,
        approved: topic.approved,
        ceiling: topic.ceiling,
        target: Math.min(target.targetLevel, topic.ceiling),
        level: topic.approved ? (p?.level ?? topicLevel(map, readings, topic.id).level) : 0,
        held: p?.held ?? 0,
        total: p?.total ?? 0,
        addedAt: target.addedAt,
        fringe: ready
          .filter((row) => row.topicId === topic.id)
          .sort((a, b) => a.level - b.level)
          .map((row) => {
            const step = ladderLevel(row.level);
            return { cellId: row.cellId, level: row.level, band: step.band, can: step.can, why: fringeWhy(row, topic.name) };
          }),
      },
    ];
  });
  views.sort((a, b) => Number(b.approved) - Number(a.approved) || a.name.localeCompare(b.name));

  return {
    progress: { held: progress.held, total: progress.total, fraction: progress.fraction },
    bands: bandCounts(views.filter((v) => v.approved).map((v) => v.level)),
    topics: views,
    addedToday: views.filter((v) => day.dayOf(v.addedAt) === day.today).map((v) => v.name),
  };
}

/** One field on the Know page: how deep its topics go on average. */
export type FieldLevel = { fieldId: string; name: string; topics: number; mean: number };

/**
 * Each field by the mean level of the approved topics tagged with it,
 * deepest first. A field with no tagged topic is left out.
 */
export function fieldLevels(
  map: TopicMap,
  readings: Readings,
  tags: ReadonlyMap<string, readonly string[]>,
  fields: ReadonlyArray<{ id: string; name: string }>,
): FieldLevel[] {
  const levels = new Map<string, number[]>();
  for (const topic of map.topics) {
    if (!topic.approved) continue;
    const level = topicLevel(map, readings, topic.id).level;
    for (const fieldId of tags.get(topic.id) ?? []) levels.set(fieldId, [...(levels.get(fieldId) ?? []), level]);
  }
  return fields
    .filter((f) => (levels.get(f.id)?.length ?? 0) > 0)
    .map((f) => {
      const ls = levels.get(f.id)!;
      return { fieldId: f.id, name: f.name, topics: ls.length, mean: ls.reduce((n, l) => n + l, 0) / ls.length };
    })
    .sort((a, b) => b.mean - a.mean || b.topics - a.topics || a.name.localeCompare(b.name));
}

/** "3.5", or "3" when it is whole. */
export function meanText(mean: number): string {
  const rounded = Math.round(mean * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
