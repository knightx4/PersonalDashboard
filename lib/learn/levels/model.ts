/**
 * What you know, read off the topic map (docs/LEARN-LEVELS-SPEC.md).
 *
 * Pure types and pure functions, with no client and no model call. Nothing
 * here is stored (rule R4): a cell's status, a topic's level, the fringe, the
 * next question and lens progress are all worked out from the evidence and
 * the links each time they are read, so a changed link or descriptor never
 * leaves a stale inference behind.
 *
 * The map is the rows of learn.topics, learn.topic_cells, learn.cell_links and
 * learn.cell_evidence (supabase/migrations-learn/0133_topic_levels.sql),
 * reduced to the columns these rules read.
 */

/** Ten fixed levels on every topic. */
export const MAX_LEVEL = 10;

/** Days a held cell can go without evidence before it is due a re-check. */
export const RECHECK_AFTER_DAYS = 30;

export const VERDICTS = ['met', 'not_met', 'declared'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Where one cell stands.
 *
 * `shown`, `declared` and `missed` come from the cell's own latest evidence.
 * `implied` is a cell with no evidence of its own that a shown or declared
 * cell requires, directly or through other cells. `open` is everything else.
 */
export const CELL_STATUSES = ['shown', 'implied', 'declared', 'missed', 'open'] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];

export type LevelTopic = {
  id: string;
  name: string;
  /** The highest level with content. Cells above it are ignored. */
  ceiling: number;
  /** Nothing is asked about a draft. */
  approved: boolean;
};

export type LevelCell = {
  id: string;
  topicId: string;
  level: number;
};

/** The requiring cell needs the required cell, at that cell's level. */
export type CellLink = {
  requiringCellId: string;
  requiredCellId: string;
};

export type CellEvidence = {
  cellId: string;
  verdict: Verdict;
  /** ISO time. The latest row for a cell decides its own status. */
  observedAt: string;
};

export type TopicMap = {
  topics: readonly LevelTopic[];
  cells: readonly LevelCell[];
  links: readonly CellLink[];
  evidence: readonly CellEvidence[];
};

export type CellReading = {
  cellId: string;
  topicId: string;
  level: number;
  status: CellStatus;
  /**
   * A shown cell whose requirements include a missed cell. Either its grade
   * was generous or a link is wrong, so the next question on its topic
   * re-asks it.
   */
  inDoubt: boolean;
  /** The missed cells that put it in doubt, when it is. */
  doubtedBy: string[];
  /**
   * The newest evidence that holds this cell: its own when it is shown or
   * declared, else the newest shown or declared cell that implies it. Null
   * when it is not held.
   */
  heldSince: string | null;
};

export type Readings = Map<string, CellReading>;

/** Held means shown, implied or declared. */
export function isHeld(status: CellStatus): boolean {
  return status === 'shown' || status === 'implied' || status === 'declared';
}

/** Cells at or under their topic's ceiling, with the topic they sit on. */
type Indexed = {
  topics: Map<string, LevelTopic>;
  cells: Map<string, LevelCell>;
  /** A topic's cells by level. */
  byTopic: Map<string, Map<number, LevelCell>>;
  /** A cell's direct links, as required cell ids. */
  requires: Map<string, string[]>;
  /** The cells that link to a cell directly. */
  requiredBy: Map<string, string[]>;
};

function index(map: TopicMap): Indexed {
  const topics = new Map(map.topics.map((t) => [t.id, t]));
  const cells = new Map<string, LevelCell>();
  const byTopic = new Map<string, Map<number, LevelCell>>();
  for (const cell of map.cells) {
    const topic = topics.get(cell.topicId);
    if (!topic || cell.level < 1 || cell.level > Math.min(topic.ceiling, MAX_LEVEL)) continue;
    cells.set(cell.id, cell);
    const levels = byTopic.get(cell.topicId) ?? new Map<number, LevelCell>();
    levels.set(cell.level, cell);
    byTopic.set(cell.topicId, levels);
  }
  const requires = new Map<string, string[]>();
  const requiredBy = new Map<string, string[]>();
  for (const link of map.links) {
    if (!cells.has(link.requiringCellId) || !cells.has(link.requiredCellId)) continue;
    requires.set(link.requiringCellId, [...(requires.get(link.requiringCellId) ?? []), link.requiredCellId]);
    requiredBy.set(link.requiredCellId, [...(requiredBy.get(link.requiredCellId) ?? []), link.requiringCellId]);
  }
  return { topics, cells, byTopic, requires, requiredBy };
}

/**
 * Every cell the given cells require, through the level chain and the links,
 * leaving out the given cells themselves unless another of them requires
 * them.
 *
 * Walked per topic as the database's cycle check does: reaching level L of a
 * topic reaches every level below it, and the links of all those cells are
 * followed. Terminates on any input, a cycle included, because the reached
 * level per topic only rises and is bounded.
 */
function cone(ix: Indexed, from: readonly string[]): Set<string> {
  // The highest level reached on each topic, inclusive.
  const reached = new Map<string, number>();
  // The highest level whose links have been followed on each topic.
  const followed = new Map<string, number>();
  const work: Array<{ topicId: string; level: number; include: boolean }> = [];
  for (const id of from) {
    const cell = ix.cells.get(id);
    if (cell) work.push({ topicId: cell.topicId, level: cell.level, include: false });
  }
  while (work.length > 0) {
    const { topicId, level, include } = work.pop()!;
    const top = include ? level : level - 1;
    if (top > (reached.get(topicId) ?? 0)) reached.set(topicId, top);
    const done = followed.get(topicId) ?? 0;
    if (level <= done) continue;
    followed.set(topicId, level);
    const levels = ix.byTopic.get(topicId);
    if (!levels) continue;
    for (const [l, cell] of levels) {
      if (l <= done || l > level) continue;
      for (const requiredId of ix.requires.get(cell.id) ?? []) {
        const required = ix.cells.get(requiredId)!;
        work.push({ topicId: required.topicId, level: required.level, include: true });
      }
    }
  }
  const out = new Set<string>();
  for (const [topicId, top] of reached) {
    for (const [l, cell] of ix.byTopic.get(topicId) ?? []) if (l <= top) out.add(cell.id);
  }
  return out;
}

/** Each cell's own latest evidence, the later row winning a tie. */
function latestEvidence(ix: Indexed, evidence: readonly CellEvidence[]): Map<string, CellEvidence> {
  const latest = new Map<string, CellEvidence>();
  for (const row of evidence) {
    if (!ix.cells.has(row.cellId)) continue;
    const seen = latest.get(row.cellId);
    if (!seen || row.observedAt >= seen.observedAt) latest.set(row.cellId, row);
  }
  return latest;
}

/** The status of every cell on the map. */
export function readCells(map: TopicMap): Readings {
  const ix = index(map);
  const latest = latestEvidence(ix, map.evidence);

  const own = new Map<string, CellStatus>();
  for (const [cellId, row] of latest) {
    own.set(cellId, row.verdict === 'met' ? 'shown' : row.verdict === 'declared' ? 'declared' : 'missed');
  }

  // Each holding cell's cone, newest first, so the first to reach a cell
  // gives it the date it has been held since.
  const seeds = [...latest.values()]
    .filter((row) => row.verdict !== 'not_met')
    .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
  const impliedSince = new Map<string, string>();
  const cones = new Map<string, Set<string>>();
  for (const seed of seeds) {
    const reach = cone(ix, [seed.cellId]);
    cones.set(seed.cellId, reach);
    for (const id of reach) if (!impliedSince.has(id)) impliedSince.set(id, seed.observedAt);
  }

  const readings: Readings = new Map();
  for (const cell of ix.cells.values()) {
    const mine = own.get(cell.id);
    const status: CellStatus = mine ?? (impliedSince.has(cell.id) ? 'implied' : 'open');
    let doubtedBy: string[] = [];
    if (status === 'shown') {
      doubtedBy = [...(cones.get(cell.id) ?? [])].filter((id) => own.get(id) === 'missed').sort();
    }
    const ownSince = status === 'shown' || status === 'declared' ? latest.get(cell.id)!.observedAt : null;
    const implied = impliedSince.get(cell.id) ?? null;
    readings.set(cell.id, {
      cellId: cell.id,
      topicId: cell.topicId,
      level: cell.level,
      status,
      inDoubt: doubtedBy.length > 0,
      doubtedBy,
      heldSince: !isHeld(status)
        ? null
        : ownSince && implied
          ? (ownSince > implied ? ownSince : implied)
          : (ownSince ?? implied),
    });
  }
  return readings;
}

export type TopicLevel = {
  topicId: string;
  /** The highest L with cells 1 to L all held; 0 when level 1 is not. */
  level: number;
  /** Held levels above the first gap, shown above it on the ladder. */
  heldAboveGap: number[];
};

/** A topic's level: the top of the unbroken run of held cells from level 1. */
export function topicLevel(map: TopicMap, readings: Readings, topicId: string): TopicLevel {
  const topic = map.topics.find((t) => t.id === topicId);
  const ceiling = topic ? Math.min(topic.ceiling, MAX_LEVEL) : 0;
  const held = new Set<number>();
  for (const r of readings.values()) if (r.topicId === topicId && isHeld(r.status)) held.add(r.level);
  let level = 0;
  while (level < ceiling && held.has(level + 1)) level += 1;
  const heldAboveGap = [...held].filter((l) => l > level + 1).sort((a, b) => a - b);
  return { topicId, level, heldAboveGap };
}

export type FringeRow = {
  cellId: string;
  topicId: string;
  level: number;
  /** Deeper on a topic where something is held; wider onto one with nothing held. */
  direction: 'deeper' | 'wider';
  status: 'open' | 'missed';
  /** How many other cells would join the fringe if this one were held. */
  unlocks: number;
  /** Below the target of a lens being worked towards. */
  inLens: boolean;
};

/** The cells a cell needs directly: the level below it and the links of it and every cell below it. */
function needs(ix: Indexed, cell: LevelCell): string[] {
  const out: string[] = [];
  const levels = ix.byTopic.get(cell.topicId)!;
  const below = levels.get(cell.level - 1);
  if (below) out.push(below.id);
  for (const [l, c] of levels) if (l <= cell.level) out.push(...(ix.requires.get(c.id) ?? []));
  return out;
}

function onFringe(ix: Indexed, cell: LevelCell, held: (id: string) => boolean): boolean {
  if (held(cell.id)) return false;
  if (!ix.topics.get(cell.topicId)!.approved) return false;
  // A level with no cell row below it is a hole in the topic, not a pass.
  if (cell.level > 1 && !ix.byTopic.get(cell.topicId)!.has(cell.level - 1)) return false;
  return needs(ix, cell).every(held);
}

export type FringeOptions = {
  /** Target level per topic, from the lenses being worked towards. */
  lensTargets?: ReadonlyMap<string, number>;
  /** Interest weight per topic, higher first (the flow's track weights). */
  weight?: (topicId: string) => number;
};

/**
 * Every open or missed cell whose level below is held and whose required
 * cells are all held, ranked: inside a lens below its target first, then by
 * interest weight, then by how many cells holding it would unlock.
 */
export function fringe(map: TopicMap, readings: Readings, options: FringeOptions = {}): FringeRow[] {
  const ix = index(map);
  const held = (id: string) => {
    const r = readings.get(id);
    return r !== undefined && isHeld(r.status);
  };
  const rows: FringeRow[] = [];
  const members = [...ix.cells.values()].filter((cell) => onFringe(ix, cell, held));
  const memberIds = new Set(members.map((c) => c.id));

  for (const cell of members) {
    const withThis = (id: string) => id === cell.id || held(id);
    let unlocks = 0;
    for (const other of ix.cells.values()) {
      if (other.id === cell.id || memberIds.has(other.id)) continue;
      if (onFringe(ix, other, withThis)) unlocks += 1;
    }
    const topicHeld = [...(ix.byTopic.get(cell.topicId)?.values() ?? [])].some((c) => held(c.id));
    const target = options.lensTargets?.get(cell.topicId);
    rows.push({
      cellId: cell.id,
      topicId: cell.topicId,
      level: cell.level,
      direction: topicHeld ? 'deeper' : 'wider',
      status: readings.get(cell.id)?.status === 'missed' ? 'missed' : 'open',
      unlocks,
      inLens: target !== undefined && cell.level <= target,
    });
  }

  const weight = options.weight ?? (() => 0);
  return rows.sort(
    (a, b) =>
      Number(b.inLens) - Number(a.inLens) ||
      weight(b.topicId) - weight(a.topicId) ||
      b.unlocks - a.unlocks ||
      a.level - b.level ||
      a.cellId.localeCompare(b.cellId),
  );
}

export type NextQuestion = {
  cellId: string;
  topicId: string;
  level: number;
  /**
   * `doubt`: a shown cell put in doubt by a miss beneath it, asked again.
   * `placement`: bisecting between the topic's level and its lowest miss.
   * `settle`: after placement, the cell whose answer settles the most.
   */
  reason: 'doubt' | 'placement' | 'settle';
};

/**
 * The cell to ask about next on one topic, or null when the topic is a draft
 * or has nothing left to ask.
 */
export function nextQuestion(map: TopicMap, readings: Readings, topicId: string): NextQuestion | null {
  const ix = index(map);
  const topic = ix.topics.get(topicId);
  if (!topic || !topic.approved) return null;
  const levels = ix.byTopic.get(topicId);
  if (!levels || levels.size === 0) return null;
  const ceiling = Math.min(topic.ceiling, MAX_LEVEL);
  const at = (cell: LevelCell, reason: NextQuestion['reason']): NextQuestion => ({
    cellId: cell.id,
    topicId,
    level: cell.level,
    reason,
  });

  // A doubted cell is asked again, the lowest first.
  const doubted = [...levels.values()]
    .filter((c) => readings.get(c.id)?.inDoubt)
    .sort((a, b) => a.level - b.level);
  if (doubted.length > 0) return at(doubted[0], 'doubt');

  // Placement: bisect between the level and the lowest miss above it.
  const { level } = topicLevel(map, readings, topicId);
  const missedAbove = [...levels.values()]
    .filter((c) => c.level > level && readings.get(c.id)?.status === 'missed')
    .map((c) => c.level);
  const lowestMiss = missedAbove.length > 0 ? Math.min(...missedAbove) : ceiling + 1;
  if (lowestMiss - level > 1) {
    const upper = lowestMiss - 1;
    const mid = Math.ceil((level + upper) / 2);
    const candidates = [...levels.values()]
      .filter((c) => c.level > level && c.level <= upper && !isHeld(readings.get(c.id)?.status ?? 'open'))
      .sort((a, b) => Math.abs(a.level - mid) - Math.abs(b.level - mid) || a.level - b.level);
    if (candidates.length > 0) return at(candidates[0], 'placement');
  }

  // After placement: the not-held cell whose smaller count is largest.
  const best = mostSettling(ix, readings, [...levels.values()]);
  return best ? at(best, 'settle') : null;
}

/**
 * Of the candidates not held, the one whose answer settles the most: if met,
 * the open cells it would imply; if missed, the open cells that need it and
 * so are ruled out for now. The smaller of the two is the score, and the
 * largest score wins, the lower level breaking a tie.
 */
function mostSettling(ix: Indexed, readings: Readings, candidates: readonly LevelCell[]): LevelCell | null {
  const isOpen = (id: string) => (readings.get(id)?.status ?? 'open') === 'open';
  let best: { cell: LevelCell; score: number } | null = null;
  for (const cell of candidates) {
    if (isHeld(readings.get(cell.id)?.status ?? 'open')) continue;
    const ifMet = [...cone(ix, [cell.id])].filter(isOpen).length;
    let ifMissed = 0;
    for (const other of ix.cells.values()) {
      if (other.id !== cell.id && isOpen(other.id) && cone(ix, [other.id]).has(cell.id)) ifMissed += 1;
    }
    const score = Math.min(ifMet, ifMissed);
    if (!best || score > best.score || (score === best.score && cell.level < best.cell.level)) {
      best = { cell, score };
    }
  }
  return best?.cell ?? null;
}

export type Recheck = {
  cellId: string;
  topicId: string;
  level: number;
  heldSince: string;
};

/**
 * Per topic, its highest held cell when that cell has gone more than thirty
 * days without evidence, oldest first. One answer there re-tests the cone
 * beneath it. The flow decides how often to ask one (one in five).
 */
export function dueRechecks(map: TopicMap, readings: Readings, now: Date): Recheck[] {
  const cutoff = new Date(now.getTime() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const approved = new Set(map.topics.filter((t) => t.approved).map((t) => t.id));
  const highest = new Map<string, CellReading>();
  for (const r of readings.values()) {
    if (!approved.has(r.topicId) || !isHeld(r.status)) continue;
    const seen = highest.get(r.topicId);
    if (!seen || r.level > seen.level) highest.set(r.topicId, r);
  }
  return [...highest.values()]
    .filter((r) => r.heldSince !== null && r.heldSince < cutoff)
    .map((r) => ({ cellId: r.cellId, topicId: r.topicId, level: r.level, heldSince: r.heldSince! }))
    .sort((a, b) => (a.heldSince < b.heldSince ? -1 : a.heldSince > b.heldSince ? 1 : 0));
}

export type LensTarget = { topicId: string; targetLevel: number };

export type LensProgress = {
  held: number;
  total: number;
  /** held / total; 0 for a lens with no cells to count. */
  fraction: number;
  topics: Array<{ topicId: string; targetLevel: number; level: number; held: number; total: number }>;
};

/**
 * Held cells at or below each target, over all cells at or below each
 * target. Adding a topic to a lens lowers it, which the lens page says.
 */
export function lensProgress(map: TopicMap, readings: Readings, targets: readonly LensTarget[]): LensProgress {
  const ix = index(map);
  const topics = targets.map(({ topicId, targetLevel }) => {
    let held = 0;
    let total = 0;
    for (const [l, cell] of ix.byTopic.get(topicId) ?? []) {
      if (l > targetLevel) continue;
      total += 1;
      if (isHeld(readings.get(cell.id)?.status ?? 'open')) held += 1;
    }
    return { topicId, targetLevel, level: topicLevel(map, readings, topicId).level, held, total };
  });
  const held = topics.reduce((n, t) => n + t.held, 0);
  const total = topics.reduce((n, t) => n + t.total, 0);
  return { held, total, fraction: total === 0 ? 0 : held / total, topics };
}

/** The question a level calls for (the spec's "Levels are not rungs"). */
export function questionFormat(level: number): 'explain' | 'case' | 'defend' {
  if (level >= 4 && level <= 6) return 'case';
  if (level === MAX_LEVEL) return 'defend';
  return 'explain';
}
