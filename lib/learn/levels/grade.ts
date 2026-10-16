/**
 * Grading an answer against levels (docs/LEARN-LEVELS-SPEC.md, "How answers
 * are graded"), the parts that need no model call.
 *
 * - `graderCells` picks the cells the grader is shown: the asked cell, the
 *   cells two levels above and below it on its topic, and every cell it
 *   requires through its links and the links of the cells below it.
 * - `applyGradeRules` turns what the grader returned into the evidence to
 *   write, by the spec's three rules. The database does not enforce them
 *   (0133's comments say so), so this is the only place they hold:
 *     1. a `met` without a quote found verbatim in the answer is dropped;
 *     2. `not met` is written only for the asked cell;
 *     3. `not touched` writes nothing.
 * - `linkReviewsFor` finds the links to put up for review when a cell in
 *   doubt is shown again while the miss beneath it still stands (the spec's
 *   "When evidence disagrees", rule 3).
 * - `whatMoved` lists every cell the answer reached, for the answer screen.
 *
 * Pure, so every rule is tested without a client or a model
 * (grade.test.ts).
 */

import {
  isHeld,
  questionFormat,
  readCells,
  type CellEvidence,
  type CellLink,
  type LevelCell,
  type LevelTopic,
  type Readings,
} from '@/lib/learn/levels/model';

/** A cell as loaded for grading: its checks as well as its place. */
export type GradeCell = LevelCell & { descriptor: readonly string[] };
export type GradeLink = CellLink & { id: string };
export type GradeEvidence = CellEvidence & { id: string };

/**
 * The topic map with what grading reads beyond the model: descriptors, and
 * ids on links and evidence so a link review can name both. Assignable to
 * `TopicMap`, so `readCells` takes it as it is.
 */
export type GradeMap = {
  topics: readonly LevelTopic[];
  cells: readonly GradeCell[];
  links: readonly GradeLink[];
  evidence: readonly GradeEvidence[];
};

/** How far above and below the asked cell the grader looks on its topic. */
export const NEARBY_LEVELS = 2;

export type GraderRole = 'asked' | 'nearby' | 'required';

/** One cell the grader is shown. `key` is the short name the prompt uses for it. */
export type GraderCell = {
  key: string;
  cellId: string;
  topicId: string;
  topicName: string;
  level: number;
  descriptor: readonly string[];
  role: GraderRole;
};

/**
 * The cells to grade an answer against, the asked one first, or null when
 * the asked cell is not on an approved topic (nothing is asked about a
 * draft). Cells on draft topics are left out wherever they are linked.
 */
export function graderCells(map: GradeMap, askedCellId: string): GraderCell[] | null {
  const topics = new Map(map.topics.map((t) => [t.id, t]));
  const usable = (cell: GradeCell | undefined): cell is GradeCell => {
    if (!cell) return false;
    const topic = topics.get(cell.topicId);
    return Boolean(topic && topic.approved && cell.level >= 1 && cell.level <= topic.ceiling);
  };
  const cells = new Map(map.cells.map((c) => [c.id, c]));
  const asked = cells.get(askedCellId);
  if (!usable(asked)) return null;

  const out: Array<Omit<GraderCell, 'key'>> = [];
  const seen = new Set<string>();
  const add = (cell: GradeCell, role: GraderRole) => {
    if (seen.has(cell.id)) return;
    seen.add(cell.id);
    out.push({
      cellId: cell.id,
      topicId: cell.topicId,
      topicName: topics.get(cell.topicId)!.name,
      level: cell.level,
      descriptor: cell.descriptor,
      role,
    });
  };

  add(asked, 'asked');
  const sameTopic = map.cells
    .filter((c) => c.topicId === asked.topicId && c.id !== asked.id && usable(c))
    .filter((c) => Math.abs(c.level - asked.level) <= NEARBY_LEVELS)
    .sort((a, b) => a.level - b.level);
  for (const cell of sameTopic) add(cell, 'nearby');

  // A link from a lower cell holds for the asked one through the level chain.
  const onTopicAtOrBelow = new Set(
    map.cells.filter((c) => c.topicId === asked.topicId && c.level <= asked.level).map((c) => c.id),
  );
  const required = map.links
    .filter((l) => onTopicAtOrBelow.has(l.requiringCellId))
    .map((l) => cells.get(l.requiredCellId))
    .filter(usable)
    .sort((a, b) => topics.get(a.topicId)!.name.localeCompare(topics.get(b.topicId)!.name) || a.level - b.level);
  for (const cell of required) add(cell, 'required');

  return out.map((cell, i) => ({ ...cell, key: `C${i + 1}` }));
}

/** What the grader said about one cell, by its key. */
export type RawVerdict = {
  cell: string;
  verdict: 'met' | 'not_met' | 'not_touched';
  quote?: string | null;
  /** One sentence on why, kept on the row; the rules ignore it. */
  reason?: string | null;
};

export type EvidenceToWrite = {
  cellId: string;
  verdict: 'met' | 'not_met';
  /** Verbatim from the answer on a met; null on a not met. */
  quote: string | null;
};

export type DroppedVerdict = {
  cellId: string;
  why: 'no-quote' | 'quote-not-in-answer' | 'not-met-off-the-asked-cell';
};

/**
 * The evidence an answer writes, by the three rules. Verdicts on keys the
 * grader was not given are ignored, and only the first verdict on a cell
 * counts. The quote must appear in the answer exactly as written, apart from
 * spaces at its ends: a quote the grader paraphrased is not evidence.
 */
export function applyGradeRules(input: {
  cells: readonly GraderCell[];
  answer: string;
  verdicts: readonly RawVerdict[];
}): { write: EvidenceToWrite[]; dropped: DroppedVerdict[] } {
  const byKey = new Map(input.cells.map((c) => [c.key, c]));
  const write: EvidenceToWrite[] = [];
  const dropped: DroppedVerdict[] = [];
  const done = new Set<string>();

  for (const v of input.verdicts) {
    const cell = byKey.get(v.cell);
    if (!cell || done.has(cell.cellId)) continue;
    done.add(cell.cellId);

    if (v.verdict === 'not_touched') continue;

    if (v.verdict === 'not_met') {
      if (cell.role === 'asked') write.push({ cellId: cell.cellId, verdict: 'not_met', quote: null });
      else dropped.push({ cellId: cell.cellId, why: 'not-met-off-the-asked-cell' });
      continue;
    }

    const quote = (v.quote ?? '').trim();
    if (quote === '') {
      dropped.push({ cellId: cell.cellId, why: 'no-quote' });
    } else if (!input.answer.includes(quote)) {
      dropped.push({ cellId: cell.cellId, why: 'quote-not-in-answer' });
    } else {
      write.push({ cellId: cell.cellId, verdict: 'met', quote });
    }
  }
  return { write, dropped };
}

/** A link to put up for review, with the evidence on both sides of it. */
export type LinkReviewToWrite = {
  linkId: string;
  /** The cell shown again, and the evidence row that showed it. */
  shownCellId: string;
  shownEvidenceId: string;
  /** The miss beneath it, and its latest not-met row. */
  missedCellId: string;
  missedEvidenceId: string;
};

/**
 * When a cell that was in doubt is met again, each miss that doubted it
 * points at a link that is probably wrong. The link is the one from the
 * shown cell's topic (at or below its level) whose required cell is the miss
 * or reaches it. One review per link; the store skips a link that already
 * has an open review.
 *
 * `newEvidence` maps each cell the answer met to the id of the row that
 * recorded it.
 */
export function linkReviewsFor(
  map: GradeMap,
  before: Readings,
  newEvidence: ReadonlyMap<string, string>,
): LinkReviewToWrite[] {
  const cells = new Map(map.cells.map((c) => [c.id, c]));
  const latestMiss = new Map<string, GradeEvidence>();
  const latest = new Map<string, GradeEvidence>();
  for (const row of map.evidence) {
    const seen = latest.get(row.cellId);
    if (!seen || row.observedAt >= seen.observedAt) latest.set(row.cellId, row);
  }
  for (const [cellId, row] of latest) if (row.verdict === 'not_met') latestMiss.set(cellId, row);

  // Whether the required cell reaches the miss: the miss itself, or a cell
  // it implies once held.
  const reaches = (requiredCellId: string, missedCellId: string): boolean => {
    if (requiredCellId === missedCellId) return true;
    const reading = readCells({
      topics: map.topics,
      cells: map.cells,
      links: map.links,
      evidence: [{ cellId: requiredCellId, verdict: 'met', observedAt: '1970-01-01T00:00:00.000Z' }],
    }).get(missedCellId);
    return reading?.status === 'implied';
  };

  const out: LinkReviewToWrite[] = [];
  const taken = new Set<string>();
  for (const [shownCellId, shownEvidenceId] of newEvidence) {
    const was = before.get(shownCellId);
    const shown = cells.get(shownCellId);
    if (!was || !shown || was.status !== 'shown' || !was.inDoubt) continue;
    for (const missedCellId of was.doubtedBy) {
      const miss = latestMiss.get(missedCellId);
      if (!miss) continue;
      for (const link of map.links) {
        if (taken.has(link.id)) continue;
        const requiring = cells.get(link.requiringCellId);
        if (!requiring || requiring.topicId !== shown.topicId || requiring.level > shown.level) continue;
        if (!reaches(link.requiredCellId, missedCellId)) continue;
        taken.add(link.id);
        out.push({ linkId: link.id, shownCellId, shownEvidenceId, missedCellId, missedEvidenceId: miss.id });
      }
    }
  }
  return out;
}

/** How the answer reached a cell, as the answer screen says it. */
export type ReachedHow = 'shown' | 'implied' | 'missed';

export type ReachedCell = {
  cellId: string;
  topicName: string;
  level: number;
  how: ReachedHow;
  /** The asked cell. */
  asked: boolean;
  /** The words of the answer that met it, on a shown cell. */
  quote: string | null;
  /** On an implied cell, the shown cell that needs it. */
  via: { topicName: string; level: number } | null;
  /** The cell's checks, so the screen can say what was met. */
  descriptor: readonly string[];
};

export type Moved = {
  reached: ReachedCell[];
  /** Links put up for review by this answer, as the two cells they join. */
  doubted: Array<{ from: { topicName: string; level: number }; to: { topicName: string; level: number } }>;
};

/**
 * Every cell the answer reached: each cell it showed, with its quote; each
 * cell newly implied by those, with the shown cell that needs it; and the
 * asked cell when it was missed. Shown first, then implied, then missed,
 * each by topic and level.
 */
export function whatMoved(input: {
  map: GradeMap;
  askedCellId: string;
  before: Readings;
  after: Readings;
  written: readonly EvidenceToWrite[];
  reviews: readonly LinkReviewToWrite[];
}): Moved {
  const topicName = new Map(input.map.topics.map((t) => [t.id, t.name]));
  const cells = new Map(input.map.cells.map((c) => [c.id, c]));
  const place = (cellId: string) => {
    const cell = cells.get(cellId)!;
    return { topicName: topicName.get(cell.topicId) ?? '', level: cell.level };
  };

  const shownIds = input.written.filter((w) => w.verdict === 'met').map((w) => w.cellId);
  const reached: ReachedCell[] = [];
  for (const w of input.written) {
    const cell = cells.get(w.cellId);
    if (!cell) continue;
    reached.push({
      cellId: w.cellId,
      ...place(w.cellId),
      how: w.verdict === 'met' ? 'shown' : 'missed',
      asked: w.cellId === input.askedCellId,
      quote: w.quote,
      via: null,
      descriptor: cell.descriptor,
    });
  }

  // Newly implied: not held before, implied now. The shown cell that reaches
  // it is found by reading each shown cell's cone on its own.
  // A draft topic's cells are left out: nothing is asked about a draft, and
  // the screen does not name topics you have not approved.
  const approved = new Set(input.map.topics.filter((t) => t.approved).map((t) => t.id));
  const newlyImplied = [...input.after.values()].filter(
    (r) =>
      r.status === 'implied' &&
      approved.has(r.topicId) &&
      !isHeld(input.before.get(r.cellId)?.status ?? 'open'),
  );
  const coneOf = new Map<string, Readings>();
  for (const id of shownIds) {
    coneOf.set(
      id,
      readCells({
        topics: input.map.topics,
        cells: input.map.cells,
        links: input.map.links,
        evidence: [{ cellId: id, verdict: 'met', observedAt: '1970-01-01T00:00:00.000Z' }],
      }),
    );
  }
  for (const r of newlyImplied) {
    const cell = cells.get(r.cellId);
    if (!cell) continue;
    const by = shownIds.find((id) => coneOf.get(id)?.get(r.cellId)?.status === 'implied');
    reached.push({
      cellId: r.cellId,
      ...place(r.cellId),
      how: 'implied',
      asked: false,
      quote: null,
      via: by ? place(by) : null,
      descriptor: cell.descriptor,
    });
  }

  const order: Record<ReachedHow, number> = { shown: 0, implied: 1, missed: 2 };
  reached.sort(
    (a, b) =>
      order[a.how] - order[b.how] ||
      Number(b.asked) - Number(a.asked) ||
      a.topicName.localeCompare(b.topicName) ||
      a.level - b.level,
  );

  const links = new Map(input.map.links.map((l) => [l.id, l]));
  const doubted = input.reviews
    .map((r) => links.get(r.linkId))
    .filter((l): l is GradeLink => Boolean(l))
    .map((l) => ({ from: place(l.requiringCellId), to: place(l.requiredCellId) }));

  return { reached, doubted };
}

/**
 * The explain question for a cell, from the ladder's "you can" column with
 * the topic's name in it. Written in code rather than by a model call: the
 * grader reads the answer against the cell's checks and its neighbours, so
 * the question only has to point at the level, and a free question is one
 * nobody pays for when it is skipped. Null at the levels that are not
 * explained (4 to 6 are cases, 10 a defence).
 */
export function explainQuestion(topicName: string, level: number): string | null {
  if (questionFormat(level) !== 'explain') return null;
  const name = topicName.trim();
  switch (level) {
    case 1:
      return `Where does ${name} fit? Say what field it belongs to and what it is used for.`;
    case 2:
      return `In your own words, what is ${name}?`;
    case 3:
      return `Explain how ${name} works. Take each part in turn and say why it is there.`;
    case 7:
      return `Where does ${name} stop working? Name the assumptions it rests on, how it fails, and what you would use instead.`;
    case 8:
      return `How does ${name} connect to the ideas around it? Derive it, or show how it relates to a neighbouring idea.`;
    case 9:
      return `What do practitioners do with ${name} that most people who know it never learn? Describe a move and when you would use it.`;
    default:
      return null;
  }
}

