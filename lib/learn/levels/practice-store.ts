import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { GradeMap } from '@/lib/learn/levels/grade';
import type { RunSummary } from '@/lib/learn/levels/run';
import { preparedSubjectIds } from '@/lib/learn/prepare/store';

/**
 * The reads Practice Flow needs around the topic map to choose a level and to
 * sum up a run (plan #2138.6). Nothing here writes: asking and answering are
 * lib/learn/levels/answer-store.ts.
 */

export type LensScope = {
  /** The highest target any lens sets on each topic. */
  targets: Map<string, number>;
  /**
   * The topics of the focused subject's lens, or, with no subject focused, of
   * the subjects Practice asks about by default (`practiceSubjectIds`); null
   * only when neither narrows it.
   */
  topics: Set<string> | null;
};

/**
 * The subjects Practice Flow asks about when none is focused (plan #2302.1):
 * every subject whose preparation has finished, and every subject a goal
 * points at. Hidden survey subjects are not subjects to ask about.
 */
export async function practiceSubjectIds(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const [prepared, goals] = await Promise.all([
    preparedSubjectIds(learn, userId),
    learn.from('subjects').select('id').eq('user_id', userId).not('aim_id', 'is', null).eq('survey', false),
  ]);
  if (goals.error) throw new Error(`Reading your goals' subjects failed: ${goals.error.message}`);
  const ids = new Set(prepared);
  for (const row of (goals.data ?? []) as { id: string }[]) ids.add(row.id);
  return ids;
}

/**
 * Every lens target, and the topics Practice asks about: one subject's lens
 * when the flow is focused on it, else the lenses of `subjects` when given.
 */
export async function loadLensScope(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string | null,
  subjects?: ReadonlySet<string>,
): Promise<LensScope> {
  const { data, error } = await learn
    .from('lens_targets')
    .select('topic_id, target_level, lens:lenses!inner(subject_id)')
    .eq('user_id', userId);
  if (error) throw new Error(`Reading your lenses failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    topic_id: string;
    target_level: number;
    lens: { subject_id: string | null };
  }>;
  const targets = new Map<string, number>();
  const topics = subjectId || subjects ? new Set<string>() : null;
  for (const r of rows) {
    targets.set(r.topic_id, Math.max(targets.get(r.topic_id) ?? 0, r.target_level));
    const wanted = subjectId ? r.lens.subject_id === subjectId : r.lens.subject_id !== null && subjects?.has(r.lens.subject_id);
    if (topics && wanted) topics.add(r.topic_id);
  }
  return { targets, topics };
}

/** Cell questions answered, since a time when one is given. */
export async function countAnswered(learn: LearnSupabaseClient, userId: string, since?: string): Promise<number> {
  let query = learn
    .from('cell_questions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('answered_at', 'is', null);
  if (since) query = query.gte('answered_at', since);
  const { count, error } = await query;
  if (error) throw new Error(`Counting your answers failed: ${error.message}`);
  return count ?? 0;
}

/** Links put up for review since a time, as the two levels they join. */
export async function loadRunDoubts(
  learn: LearnSupabaseClient,
  userId: string,
  since: string,
  map: GradeMap,
): Promise<RunSummary['doubted']> {
  const { data, error } = await learn
    .from('link_reviews')
    .select('link_id')
    .eq('user_id', userId)
    .gte('created_at', since)
    .not('link_id', 'is', null);
  if (error) throw new Error(`Reading the links in question failed: ${error.message}`);
  const links = new Map(map.links.map((l) => [l.id, l]));
  const cells = new Map(map.cells.map((c) => [c.id, c]));
  const names = new Map(map.topics.map((t) => [t.id, t.name]));
  const level = (cellId: string) => {
    const cell = cells.get(cellId);
    return cell ? { topicName: names.get(cell.topicId) ?? '', level: cell.level } : null;
  };
  const out: RunSummary['doubted'] = [];
  for (const { link_id } of (data ?? []) as Array<{ link_id: string }>) {
    const link = links.get(link_id);
    const from = link && level(link.requiringCellId);
    const to = link && level(link.requiredCellId);
    if (from && to) out.push({ from, to });
  }
  return out;
}
