import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { evidenceFromRows, type EvidenceLink, type EvidenceRow } from './model';

/**
 * Reading the evidence for an idea (plan #2006.1). The rows are
 * learn.evidence_links (migration learn 0121); the daily run writes them, one
 * step per kind of source, and this only reads. The ordering and shaping are
 * in ./model so the tests can reach them.
 */

export const EVIDENCE_COLUMNS =
  'id, target_kind, target_id, source_kind, source_id, similarity, weight, basis, found_at';

type LoadOptions = {
  /** Links kept per target. */
  limit?: number;
  /** Under the service role, which RLS does not narrow; the session client leaves it out. */
  userId?: string;
};

/** An idea's evidence, strongest first. */
export async function loadEvidenceForIdea(
  learn: LearnSupabaseClient,
  ideaId: string,
  options: LoadOptions = {},
): Promise<EvidenceLink[]> {
  const byTarget = await loadEvidenceForTargets(learn, 'idea', [ideaId], options);
  return byTarget.get(ideaId) ?? [];
}

/** The evidence for many ideas or topics in one read, strongest first within each. */
export async function loadEvidenceForTargets(
  learn: LearnSupabaseClient,
  targetKind: 'idea' | 'topic',
  targetIds: string[],
  options: LoadOptions = {},
): Promise<Map<string, EvidenceLink[]>> {
  const out = new Map<string, EvidenceLink[]>();
  if (targetIds.length === 0) return out;

  let query = learn
    .from('evidence_links')
    .select(EVIDENCE_COLUMNS)
    .eq('target_kind', targetKind)
    .in('target_id', targetIds)
    .order('weight', { ascending: false });
  if (options.userId) query = query.eq('user_id', options.userId);

  const { data, error } = await query;
  if (error) {
    assertSchemaExposed(error, LEARN_SCHEMA);
    throw new Error(`Reading evidence failed: ${error.message}`);
  }

  const grouped = new Map<string, EvidenceRow[]>();
  for (const row of (data ?? []) as EvidenceRow[]) {
    const list = grouped.get(row.target_id) ?? [];
    list.push(row);
    grouped.set(row.target_id, list);
  }
  for (const [id, rows] of grouped) {
    const links = evidenceFromRows(rows);
    out.set(id, options.limit === undefined ? links : links.slice(0, options.limit));
  }
  return out;
}
