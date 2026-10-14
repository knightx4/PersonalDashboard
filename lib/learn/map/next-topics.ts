/**
 * The next topics beside what you know (plan #2016.6). Pure, so the rule is
 * tested without a database.
 *
 * `learn.next_topic_candidates` (learn 0130, 0131) reads the stored vectors:
 * for each lit topic, its five nearest Level 4 topics that are not lit, and
 * the active goal each of those sits closest to. This file decides which of
 * them to offer:
 *
 * - A candidate further than MIN_BESIDE_SIMILARITY from every lit topic is
 *   dropped: it is not next to anything you know.
 * - A topic reached from several lit topics keeps the nearest as the one it
 *   sits beside.
 * - Ranked by your goals: a topic close to one of your goals comes before one
 *   that is not, by how close, and then by how near it is to what you know. A
 *   topic with no goal to rank it by (you have none active) comes last, by
 *   nearness alone.
 * - At most PER_BESIDE topics beside any one lit topic come before the
 *   others, so one subject you know well does not fill the list.
 *
 * No model is called: every number here was stored before the request.
 */

/** A row as learn.next_topic_candidates returns it. */
export type NextTopicRow = {
  topic_id: string;
  title: string;
  beside_id: string;
  beside_title: string;
  similarity: number;
  aim_id: string | null;
  aim_name: string | null;
  aim_closeness: number | null;
};

export type NextTopic = {
  id: string;
  title: string;
  /** The lit topic it sits beside. */
  beside: { id: string; title: string };
  /** Cosine similarity of the two titles, 0 to 1. */
  similarity: number;
  /** The active goal it sits closest to, or null when there is none. */
  aim: { id: string; name: string; closeness: number } | null;
};

/** Below this a candidate is not next to the topic it was found beside. */
export const MIN_BESIDE_SIMILARITY = 0.6;
/** Topics beside one lit topic before the next lit topic gets a turn. */
export const PER_BESIDE = 2;
/** Topics named on Idea Space's card: no more than about seven at a level. */
export const MAX_NEXT_TOPICS = 5;
/** Nearest topics read beside each lit topic: the step's three to five. */
export const NEAREST_PER_LIT = 5;

export type RankOptions = { limit?: number; perBeside?: number; minSimilarity?: number };

function compare(a: NextTopic, b: NextTopic): number {
  if (a.aim && !b.aim) return -1;
  if (!a.aim && b.aim) return 1;
  const closeness = (b.aim?.closeness ?? 0) - (a.aim?.closeness ?? 0);
  if (closeness !== 0) return closeness;
  return b.similarity - a.similarity || a.title.localeCompare(b.title);
}

/** The candidates as one ranked list, best first. */
export function rankNextTopics(rows: readonly NextTopicRow[], options: RankOptions = {}): NextTopic[] {
  const min = options.minSimilarity ?? MIN_BESIDE_SIMILARITY;
  const perBeside = options.perBeside ?? PER_BESIDE;

  const byTopic = new Map<string, NextTopic>();
  for (const row of rows) {
    const similarity = Number(row.similarity);
    if (!Number.isFinite(similarity) || similarity < min) continue;
    const aim =
      row.aim_id && row.aim_name && row.aim_closeness !== null && Number.isFinite(Number(row.aim_closeness))
        ? { id: row.aim_id, name: row.aim_name, closeness: Number(row.aim_closeness) }
        : null;
    const held = byTopic.get(row.topic_id);
    if (held && held.similarity >= similarity) continue;
    byTopic.set(row.topic_id, {
      id: row.topic_id,
      title: row.title,
      beside: { id: row.beside_id, title: row.beside_title },
      similarity,
      aim: aim ?? held?.aim ?? null,
    });
  }

  const ranked = [...byTopic.values()].sort(compare);
  const first: NextTopic[] = [];
  const later: NextTopic[] = [];
  const taken = new Map<string, number>();
  for (const topic of ranked) {
    const count = taken.get(topic.beside.id) ?? 0;
    if (count < perBeside) {
      first.push(topic);
      taken.set(topic.beside.id, count + 1);
    } else {
      later.push(topic);
    }
  }
  const all = [...first, ...later];
  return options.limit === undefined ? all : all.slice(0, Math.max(0, options.limit));
}

/** The ranked topics closest to one goal, in the same order. */
export function nextTopicsForAim(topics: readonly NextTopic[], aimId: string): NextTopic[] {
  return topics.filter((topic) => topic.aim?.id === aimId);
}

/** The line a card or a row says it with: "Next to Macroeconomics, which you know." */
export function besideLine(beside: string): string {
  return `Next to ${beside.trim()}, which you know.`;
}
