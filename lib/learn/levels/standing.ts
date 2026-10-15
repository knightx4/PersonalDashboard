import { ladderLevel, type Band } from '@/lib/learn/levels/ladder';
import {
  nextQuestion,
  readCells,
  topicLevel,
  type CellStatus,
  type NextQuestion,
  type TopicMap,
  type Verdict,
} from '@/lib/learn/levels/model';
import type { CellEvidenceView, TopicLinkInView } from '@/lib/learn/levels/store-page';
import type { TopicDetail, TopicLinkView } from '@/lib/learn/levels/store';

/**
 * Where a person stands on one topic, row by row (plan #2138.3): the model's
 * reading of each cell joined to the cell's wording, its evidence and its
 * links, in the shape the topic page draws. Pure, so the page and the gallery
 * build it the same way and the tests can reach it.
 */

export type LevelRow = {
  cellId: string;
  level: number;
  band: Band;
  can: string;
  checks: string[];
  rewrittenAt: string | null;
  status: CellStatus;
  inDoubt: boolean;
  /** Newest first. */
  evidence: (CellEvidenceView & { beforeRewording: boolean })[];
  needs: TopicLinkView[];
  neededBy: TopicLinkInView[];
  /** Why this is the cell asked next, when it is. */
  next: NextQuestion['reason'] | null;
};

export type TopicStanding = {
  /** The highest level with every level up to it held; 0 when level 1 is not. */
  level: number;
  /** Held levels above the first gap. */
  heldAboveGap: number[];
  rows: LevelRow[];
  /** No evidence on any cell: nothing has been asked yet. */
  untouched: boolean;
};

export function topicStanding(
  topic: TopicDetail,
  map: TopicMap,
  evidence: readonly CellEvidenceView[],
  linksIn: readonly TopicLinkInView[],
): TopicStanding {
  const readings = readCells(map);
  const { level, heldAboveGap } = topicLevel(map, readings, topic.id);
  const next = nextQuestion(map, readings, topic.id);

  const rows = topic.cells.map((cell): LevelRow => {
    const rung = ladderLevel(cell.level);
    const reading = readings.get(cell.id);
    return {
      cellId: cell.id,
      level: cell.level,
      band: rung.band,
      can: rung.can,
      checks: cell.checks,
      rewrittenAt: cell.rewrittenAt,
      status: reading?.status ?? 'open',
      inDoubt: reading?.inDoubt ?? false,
      evidence: evidence
        .filter((e) => e.cellId === cell.id)
        .map((e) => ({ ...e, beforeRewording: cell.rewrittenAt !== null && e.observedAt < cell.rewrittenAt! })),
      needs: topic.links.filter((l) => l.fromLevel === cell.level),
      neededBy: linksIn.filter((l) => l.level === cell.level),
      next: next?.cellId === cell.id ? next.reason : null,
    };
  });

  return { level, heldAboveGap, rows, untouched: evidence.length === 0 };
}

/** How a cell's status reads on the page. */
export const STATUS_WORDS: Record<CellStatus, string> = {
  shown: 'Shown',
  implied: 'Implied',
  declared: 'Declared',
  missed: 'Missed',
  open: 'Open',
};

export const VERDICT_WORDS: Record<Verdict, string> = {
  met: 'Met',
  not_met: 'Not met',
  declared: 'You declared it',
};

/** Why the next cell is the next one, in a sentence for the row. */
export const NEXT_WORDS: Record<NextQuestion['reason'], string> = {
  doubt: 'Asked again: a miss below it puts it in doubt',
  placement: 'Asked next to place you',
  settle: 'Asked next: its answer settles the most',
};
