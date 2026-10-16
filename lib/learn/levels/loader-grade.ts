import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { GradeEvidence, GradeLink, GradeMap, GradeCell } from '@/lib/learn/levels/grade';
import type { LevelTopic, Verdict } from '@/lib/learn/levels/model';

/**
 * The whole topic map of one account, as grading reads it: every topic, cell
 * and link on the shared map or the account's own, and the account's
 * evidence, with descriptors and ids (lib/learn/levels/grade.ts
 * `GradeMap`). Drafts are loaded too and marked unapproved, so the model and
 * the grader leave them out by the same rule.
 *
 * The whole map rather than the asked topic's neighbourhood, because a cell's
 * status depends on every shown cell that reaches it, however far away. The
 * map is one account's and small; pages of a thousand keep a large one whole.
 */

const PAGE = 1000;

/**
 * The PostgREST filter for the territory one account reads: shared rows (no
 * owner) and its own (plan #2138.10, learn 0145). The policies give a
 * signed-in client the same; this is for the service role, which they do not
 * bind.
 */
export function territoryOf(userId: string): string {
  return `user_id.is.null,user_id.eq.${userId}`;
}

async function all<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadGradeMap(learn: LearnSupabaseClient, userId: string): Promise<GradeMap> {
  const [topics, cells, links, evidence] = await Promise.all([
    all<{ id: string; name: string; ceiling: number; status: string }>(
      (a, b) => learn.from('topics').select('id, name, ceiling, status').or(territoryOf(userId)).order('id').range(a, b),
      'your topics',
    ),
    all<{ id: string; topic_id: string; level: number; descriptor: string[] }>(
      (a, b) =>
        learn.from('topic_cells').select('id, topic_id, level, descriptor').or(territoryOf(userId)).order('id').range(a, b),
      'the levels of your topics',
    ),
    all<{ id: string; requiring_cell_id: string; required_cell_id: string }>(
      (a, b) =>
        learn
          .from('cell_links')
          .select('id, requiring_cell_id, required_cell_id')
          .or(territoryOf(userId))
          .order('id')
          .range(a, b),
      'the links between your topics',
    ),
    all<{ id: string; cell_id: string; verdict: Verdict; observed_at: string }>(
      (a, b) =>
        learn
          .from('cell_evidence')
          .select('id, cell_id, verdict, observed_at')
          .eq('user_id', userId)
          .order('id')
          .range(a, b),
      'what your answers have shown',
    ),
  ]);

  return {
    topics: topics.map(
      (t): LevelTopic => ({ id: t.id, name: t.name, ceiling: t.ceiling, approved: t.status === 'approved' }),
    ),
    cells: cells.map(
      (c): GradeCell => ({ id: c.id, topicId: c.topic_id, level: c.level, descriptor: c.descriptor }),
    ),
    links: links.map(
      (l): GradeLink => ({ id: l.id, requiringCellId: l.requiring_cell_id, requiredCellId: l.required_cell_id }),
    ),
    // Normalised to one ISO form, since the model compares the strings.
    evidence: evidence.map(
      (e): GradeEvidence => ({
        id: e.id,
        cellId: e.cell_id,
        verdict: e.verdict,
        observedAt: new Date(e.observed_at).toISOString(),
      }),
    ),
  };
}
