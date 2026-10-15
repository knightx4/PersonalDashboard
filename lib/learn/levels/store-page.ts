import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { sameChecks } from '@/lib/learn/levels/draft-payload';
import type { Verdict } from '@/lib/learn/levels/model';

/**
 * What an approved topic's page reads beyond the topic itself (plan
 * #2138.3): the evidence on its cells, the links other topics make into it,
 * and the one write it has, rewording a level.
 *
 * Reads go through the person's own client, so RLS keeps them to their rows.
 */

type Client = LearnSupabaseClient;

/** One piece of evidence on a cell, as its page lists it. */
export type CellEvidenceView = {
  cellId: string;
  verdict: Verdict;
  /** The span of the answer that met the cell; null for a miss or a declaration. */
  quote: string | null;
  observedAt: string;
};

/** A level of another topic needing a level of this one. */
export type TopicLinkInView = {
  /** The level of this topic that is needed. */
  level: number;
  topicId: string;
  topicName: string;
  /** The level of that topic that needs it. */
  fromLevel: number;
  why: string | null;
};

/** The evidence on a topic's cells, newest first. */
export async function loadTopicEvidence(client: Client, cellIds: readonly string[]): Promise<CellEvidenceView[]> {
  if (cellIds.length === 0) return [];
  const { data, error } = await client
    .from('cell_evidence')
    .select('cell_id, verdict, quote, observed_at')
    .in('cell_id', cellIds)
    .order('observed_at', { ascending: false });
  if (error) throw new Error(`Reading the evidence on the topic failed: ${error.message}`);
  return ((data ?? []) as { cell_id: string; verdict: Verdict; quote: string | null; observed_at: string }[]).map(
    (row) => ({ cellId: row.cell_id, verdict: row.verdict, quote: row.quote, observedAt: row.observed_at }),
  );
}

/** The links other topics make into this one's cells. */
export async function loadLinksIn(
  client: Client,
  cells: readonly { id: string; level: number }[],
): Promise<TopicLinkInView[]> {
  if (cells.length === 0) return [];
  const levelOf = new Map(cells.map((c) => [c.id, c.level]));
  const { data, error } = await client
    .from('cell_links')
    .select(
      'required_cell_id, why, requiring:topic_cells!cell_links_requiring_fk(level, topic:topics!topic_cells_topic_fk(id, name))',
    )
    .in('required_cell_id', [...levelOf.keys()]);
  if (error) throw new Error(`Reading the links into the topic failed: ${error.message}`);
  const links: TopicLinkInView[] = [];
  for (const row of (data ?? []) as unknown as {
    required_cell_id: string;
    why: string | null;
    requiring: { level: number; topic: { id: string; name: string } | null } | null;
  }[]) {
    const level = levelOf.get(row.required_cell_id);
    if (level === undefined || !row.requiring?.topic) continue;
    links.push({
      level,
      topicId: row.requiring.topic.id,
      topicName: row.requiring.topic.name,
      fromLevel: row.requiring.level,
      why: row.why,
    });
  }
  return links.sort((a, b) => a.level - b.level || a.topicName.localeCompare(b.topicName));
}

/**
 * Reword one level of a topic. Stamps `rewritten_at` and keeps the drafted
 * wording in `descriptor_original` the first time. Evidence already written
 * stays as it is; the page shows it as given before the rewording. Returns
 * false when the wording is unchanged.
 */
export async function rewriteCell(client: Client, cellId: string, checks: readonly string[]): Promise<boolean> {
  const { data: cell, error } = await client
    .from('topic_cells')
    .select('id, descriptor, descriptor_original')
    .eq('id', cellId)
    .maybeSingle();
  if (error) throw new Error(`Reading the level failed: ${error.message}`);
  if (!cell) throw new Error('That level is not one of yours, or it is no longer there.');
  if (sameChecks(checks, cell.descriptor as string[])) return false;
  const { error: writeError } = await client
    .from('topic_cells')
    .update({
      descriptor: [...checks],
      descriptor_original: (cell.descriptor_original as string[] | null) ?? cell.descriptor,
      rewritten_at: new Date().toISOString(),
    })
    .eq('id', cellId);
  if (writeError) throw new Error(`Rewording the level failed: ${writeError.message}`);
  return true;
}
