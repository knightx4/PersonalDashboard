/**
 * What moved in one practice run (docs/LEARN-LEVELS-SPEC.md, "Screens": at
 * the end of a practice run, the flow lists cells newly shown, cells newly
 * implied, misses found, and any link put in doubt; plan #2138.6).
 *
 * A run is the questions answered since it started. The flow carries the start
 * in its links, so nothing about a run is stored: the summary is the map read
 * twice, once without the run's evidence and once with it.
 */

import { readCells, type TopicMap } from '@/lib/learn/levels/model';

export type RunCell = { cellId: string; topicId: string; topicName: string; level: number };

export type RunSummary = {
  /** Questions answered in the run. */
  answered: number;
  /** Levels your own words met that were not shown before. */
  shown: RunCell[];
  /** Levels newly held because a shown level needs them. */
  implied: RunCell[];
  /** Levels missed by an answer in this run. */
  missed: RunCell[];
  /** Links put up for review in this run, as the two levels they join. */
  doubted: Array<{ from: { topicName: string; level: number }; to: { topicName: string; level: number } }>;
};

function byTopicAndLevel(a: RunCell, b: RunCell): number {
  return a.topicName.localeCompare(b.topicName) || a.level - b.level;
}

export function runSummary(input: {
  map: TopicMap;
  /** ISO time the run started. */
  since: string;
  answered: number;
  doubted?: RunSummary['doubted'];
}): RunSummary {
  const since = new Date(input.since).toISOString();
  const at = (e: { observedAt: string }) => new Date(e.observedAt).toISOString();
  const beforeMap = { ...input.map, evidence: input.map.evidence.filter((e) => at(e) < since) };
  const before = readCells(beforeMap);
  const after = readCells(input.map);
  const names = new Map(input.map.topics.map((t) => [t.id, t.name]));
  const answeredIn = new Set(input.map.evidence.filter((e) => at(e) >= since).map((e) => e.cellId));

  const shown: RunCell[] = [];
  const implied: RunCell[] = [];
  const missed: RunCell[] = [];
  for (const [id, now] of after) {
    const was = before.get(id)?.status ?? 'open';
    const cell = { cellId: id, topicId: now.topicId, topicName: names.get(now.topicId) ?? '', level: now.level };
    if (now.status === 'shown' && was !== 'shown') shown.push(cell);
    else if (now.status === 'implied' && was !== 'implied' && was !== 'shown' && was !== 'declared') implied.push(cell);
    else if (now.status === 'missed' && answeredIn.has(id)) missed.push(cell);
  }
  return {
    answered: input.answered,
    shown: shown.sort(byTopicAndLevel),
    implied: implied.sort(byTopicAndLevel),
    missed: missed.sort(byTopicAndLevel),
    doubted: input.doubted ?? [],
  };
}
