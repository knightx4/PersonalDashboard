/**
 * Which level Practice Flow asks about next (docs/LEARN-LEVELS-SPEC.md,
 * "Choosing the next question" and "What to learn next: the fringe"; plan
 * #2138.6).
 *
 * Pure: the map, its readings and a few counts in, one cell and the line
 * saying why out. The order:
 *
 * 1. One answer in five is a re-check of a held level gone thirty days
 *    without evidence, when one is due.
 * 2. A topic you have not been placed on is placed by bisection. One already
 *    under way comes first, so placement finishes in a handful of questions
 *    rather than spreading over every topic at once.
 * 3. Then the fringe: misses first, then a lens's cells below its target,
 *    then what unlocks most (model.ts `fringe`).
 * 4. When the fringe is empty, the cell on a topic that settles the most.
 *
 * A cell answered in the last `REST_HOURS` is not asked again, so a level you
 * just missed does not come straight back as the next question. Level 10 is
 * not asked until the defence question exists.
 */

import {
  dueRechecks,
  fringe,
  isHeld,
  MAX_LEVEL,
  nextQuestion,
  readCells,
  topicLevel,
  type Readings,
  type TopicMap,
} from '@/lib/learn/levels/model';

/** Hours a cell rests after its own evidence before it is asked again. */
export const REST_HOURS = 12;

/** Every fifth answer is a re-check, when one is due. */
export const RECHECK_EVERY = 5;

export type PickReason = 'recheck' | 'doubt' | 'placement' | 'fringe' | 'settle';

export type PickedCell = {
  cellId: string;
  topicId: string;
  topicName: string;
  level: number;
  reason: PickReason;
  /** The topic's level when it was picked: the top of its unbroken held run. */
  heldTo: number;
  /** On a fringe pick: whether it was missed before, and which way it goes. */
  missed: boolean;
  direction: 'deeper' | 'wider' | null;
  /** On a fringe pick: how many cells holding it would bring onto the fringe. */
  unlocks: number;
  /** On a re-check: when the level was last held by an answer. */
  heldSince: string | null;
};

export type PickOptions = {
  now: Date;
  /** Cell questions answered so far, across every run. Decides the re-check turn. */
  answered: number;
  /** Target level per topic, from the lenses. */
  lensTargets?: ReadonlyMap<string, number>;
  /** Only these topics, for a flow focused on one subject's lens. */
  topics?: ReadonlySet<string>;
};

/** The cells with their own evidence inside the rest window. */
export function restingCells(map: TopicMap, now: Date): Set<string> {
  const since = new Date(now.getTime() - REST_HOURS * 60 * 60 * 1000).toISOString();
  const out = new Set<string>();
  for (const row of map.evidence) if (new Date(row.observedAt).toISOString() >= since) out.add(row.cellId);
  return out;
}

/** The newest own evidence on each topic, for ordering placements under way. */
function lastAnswered(map: TopicMap): Map<string, string> {
  const topicOf = new Map(map.cells.map((c) => [c.id, c.topicId]));
  const out = new Map<string, string>();
  for (const row of map.evidence) {
    const topicId = topicOf.get(row.cellId);
    if (!topicId) continue;
    const seen = out.get(topicId);
    if (!seen || row.observedAt > seen) out.set(topicId, row.observedAt);
  }
  return out;
}

/**
 * The readings with a resting cell's doubt lifted. A level shown a minute ago
 * over a missed one is in doubt, and asking it again at once would only
 * repeat the answer just given; it is asked once it has rested.
 */
export function withoutRestingDoubt(readings: Readings, resting: ReadonlySet<string>): Readings {
  const out: Readings = new Map();
  for (const [id, r] of readings) out.set(id, r.inDoubt && resting.has(id) ? { ...r, inDoubt: false, doubtedBy: [] } : r);
  return out;
}

/**
 * The highest level the flow can ask yet. Level 10 is a defence, which is not
 * built (model.ts `questionFormat`), so asking it would only fail.
 */
export const ASK_CEILING = MAX_LEVEL - 1;

export function pickCell(full: TopicMap, options: PickOptions): PickedCell | null {
  // Read on the whole map, so a declared level 10 still holds what is under
  // it; chosen on one capped at what can be asked.
  const readings = readCells(full);
  const map: TopicMap = {
    ...full,
    topics: full.topics.map((t) => ({ ...t, ceiling: Math.min(t.ceiling, ASK_CEILING) })),
  };
  const resting = restingCells(map, options.now);
  const asking = withoutRestingDoubt(readings, resting);
  const names = new Map(map.topics.map((t) => [t.id, t.name]));
  const inScope = (topicId: string) => !options.topics || options.topics.has(topicId);
  const approved = map.topics.filter((t) => t.approved && inScope(t.id));
  const level = (topicId: string) => topicLevel(map, readings, topicId).level;

  const picked = (
    cell: { cellId: string; topicId: string; level: number },
    reason: PickReason,
    extra: Partial<Pick<PickedCell, 'missed' | 'direction' | 'unlocks' | 'heldSince'>> = {},
  ): PickedCell => ({
    cellId: cell.cellId,
    topicId: cell.topicId,
    topicName: names.get(cell.topicId) ?? '',
    level: cell.level,
    reason,
    heldTo: level(cell.topicId),
    missed: extra.missed ?? false,
    direction: extra.direction ?? null,
    unlocks: extra.unlocks ?? 0,
    heldSince: extra.heldSince ?? null,
  });

  // 1. The re-check turn.
  if (options.answered % RECHECK_EVERY === RECHECK_EVERY - 1) {
    const due = dueRechecks(map, readings, options.now).find(
      (r) => inScope(r.topicId) && r.level <= ASK_CEILING && !resting.has(r.cellId),
    );
    if (due) return picked(due, 'recheck', { heldSince: due.heldSince });
  }

  // 2. Placement, the topic under way first, then the untouched ones by
  // whether a lens wants them and by name.
  const last = lastAnswered(map);
  const placing = approved
    .map((t) => ({ topic: t, q: nextQuestion(map, asking, t.id) }))
    .filter(
      (p): p is { topic: (typeof approved)[number]; q: NonNullable<ReturnType<typeof nextQuestion>> } =>
        p.q !== null && (p.q.reason === 'placement' || p.q.reason === 'doubt') && !resting.has(p.q.cellId),
    )
    .sort((a, b) => {
      const la = last.get(a.topic.id) ?? '';
      const lb = last.get(b.topic.id) ?? '';
      if (la !== lb) return la < lb ? 1 : -1;
      const wa = options.lensTargets?.has(a.topic.id) ? 1 : 0;
      const wb = options.lensTargets?.has(b.topic.id) ? 1 : 0;
      return wb - wa || a.topic.name.localeCompare(b.topic.name);
    });
  if (placing.length > 0) {
    const { q } = placing[0];
    return picked(q, q.reason);
  }

  // 3. The fringe.
  const row = fringe(map, readings, { lensTargets: options.lensTargets }).find(
    (r) => inScope(r.topicId) && !resting.has(r.cellId),
  );
  if (row) {
    return picked(row, 'fringe', { missed: row.status === 'missed', direction: row.direction, unlocks: row.unlocks });
  }

  // 4. What settles most on a topic, when nothing is on the fringe.
  for (const t of approved) {
    const q = nextQuestion(map, asking, t.id);
    if (q && !resting.has(q.cellId) && !isHeld(readings.get(q.cellId)?.status ?? 'open')) return picked(q, 'settle');
  }
  return null;
}

function levels(n: number): string {
  return `${n} ${n === 1 ? 'level' : 'levels'}`;
}

/** The line behind "Why this question", in the person's terms. */
export function whyLine(p: PickedCell, now: Date): string {
  switch (p.reason) {
    case 'recheck': {
      const days = p.heldSince
        ? Math.max(1, Math.floor((now.getTime() - new Date(p.heldSince).getTime()) / 86_400_000))
        : null;
      return days
        ? `You have held this level for ${days} days with no answer on it since, so it is checked again. One answer here re-tests everything under it.`
        : 'You hold this level, and it is due a check. One answer here re-tests everything under it.';
    }
    case 'doubt':
      return `You showed ${p.topicName} level ${p.level}, but a level it needs was missed later. One of those answers was wrong, so this one is asked again.`;
    case 'placement':
      return p.heldTo === 0
        ? `Finding your level on ${p.topicName}. Nothing is known about it yet, so this starts partway up: a pass rules out everything below, a miss everything above.`
        : `Finding your level on ${p.topicName}. You hold it to level ${p.heldTo}, and this splits what is still unknown above that in half.`;
    case 'fringe': {
      const opens = p.unlocks > 0 ? ` Holding it opens ${levels(p.unlocks)} more.` : '';
      if (p.missed) return `You missed this level before, and everything under it is held, so it comes back before anything new.${opens}`;
      return p.direction === 'wider'
        ? `Level ${p.level} of a topic your held levels have just made reachable.${opens}`
        : `The next level up on ${p.topicName}, which you hold to level ${p.heldTo}.${opens}`;
    }
    case 'settle':
      return `Of the levels still unknown on ${p.topicName}, an answer here settles the most, whichever way it goes.`;
  }
}
