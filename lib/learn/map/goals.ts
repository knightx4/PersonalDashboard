import { ladderLevel } from '@/lib/learn/levels/ladder';
import { lensDetail, lensLine, summariseLens, type LensRecord, type TopicName } from '@/lib/learn/levels/lenses';
import type { Readings, TopicMap } from '@/lib/learn/levels/model';
import type { Point } from './layout';

/**
 * Your learning goals on Idea Space (plan #2187.2).
 *
 * Pure: the goal lenses come from lib/learn/levels/lens-store.ts, the map
 * of topics from loadTopicMap, and each topic's place on the sky from its
 * scope's embedding, placed among the ideas as a field is
 * (lib/learn/map/area-map.ts, `placeVectors`).
 *
 * Choosing a goal in the rail draws its topics as a constellation: a faint
 * line between two of its topics wherever a level of one requires a level
 * of the other (cell_links), and a thin dashed ring round each topic, wider
 * for a higher target. Nothing is drawn for a goal not chosen, so the sky
 * holds no more marks as the map grows.
 */

/** A topic of a goal where the sky puts it, with its target and the level held. */
export type GoalStar = {
  topicId: string;
  name: string;
  targetLevel: number;
  /** The level held on it, 0 for a draft or a topic with nothing held. */
  level: number;
  pca: Point;
  neighbourMap: Point;
};

/** A requirement between two of a goal's topics: a level of `from` needs a level of `to`. */
export type GoalLink = { from: string; to: string };

export type GoalOnMap = {
  /** The lens's id, which the address holds as `goal`. */
  id: string;
  name: string;
  /** What the row says after the name: topics and levels held, or the drafts waiting. */
  line: string;
  held: number;
  total: number;
  /** The next rung: the lowest level the goal is ready for, or null when there is none. */
  next: string | null;
  /** Its topics that have a place on the sky. */
  stars: GoalStar[];
  links: GoalLink[];
};

/** A topic's place on the sky in each layout, from its scope's embedding. */
export type TopicPlacement = { pca: Point; neighbourMap: Point };

/** The dashed ring's radius in pixels for a target level: a level adds a little over a pixel. */
export const RING_BASE = 5;
export const RING_PER_LEVEL = 1.1;

export function ringRadius(targetLevel: number): number {
  return RING_BASE + RING_PER_LEVEL * Math.max(1, Math.min(10, targetLevel));
}

/** What you can do at a level, up to its first colon: "explain how it works". */
function canShort(level: number): string {
  const can = ladderLevel(level).can;
  const colon = can.indexOf(':');
  return colon > 0 ? can.slice(0, colon) : can;
}

/**
 * Each open learning goal as the sky and the rail show it, in the order the
 * lenses came (by name). A topic with no place yet is left off the sky but
 * still counted in the goal's line.
 */
export function goalsOnMap(
  lenses: readonly LensRecord[],
  map: TopicMap,
  readings: Readings,
  placed: ReadonlyMap<string, TopicPlacement>,
): GoalOnMap[] {
  const names = new Map<string, TopicName>(
    map.topics.map((t) => [t.id, { id: t.id, name: t.name, approved: t.approved, ceiling: t.ceiling }]),
  );
  const cellTopic = new Map(map.cells.map((cell) => [cell.id, cell.topicId]));
  const day = { today: '', dayOf: () => '-' };

  return lenses
    .filter((lens) => lens.origin === 'goal')
    .map((lens) => {
      const summary = summariseLens(lens, map, readings, names);
      const detail = lensDetail(lens, map, readings, names, day);
      const stars: GoalStar[] = detail.topics.flatMap((topic) => {
        const at = placed.get(topic.topicId);
        return at
          ? [{ topicId: topic.topicId, name: topic.name, targetLevel: topic.target, level: topic.level, ...at }]
          : [];
      });

      const on = new Set(stars.map((s) => s.topicId));
      const seen = new Set<string>();
      const links: GoalLink[] = [];
      for (const link of map.links) {
        const from = cellTopic.get(link.requiringCellId);
        const to = cellTopic.get(link.requiredCellId);
        if (!from || !to || from === to || !on.has(from) || !on.has(to)) continue;
        const pair = from < to ? `${from}|${to}` : `${to}|${from}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        links.push({ from, to });
      }

      const ready = detail.topics
        .filter((t) => t.approved)
        .flatMap((t) => t.fringe.map((cell) => ({ name: t.name, level: cell.level })))
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))[0];
      const approved = detail.topics.filter((t) => t.approved);
      const next = ready
        ? `Next: ${ready.name} at level ${ready.level}, ${canShort(ready.level)}`
        : approved.length > 0 && approved.every((t) => t.level >= t.target)
          ? 'Every target held'
          : null;

      return {
        id: lens.id,
        name: lens.name,
        line: lensLine(summary),
        held: summary.held,
        total: summary.total,
        next,
        stars,
        links,
      };
    });
}
