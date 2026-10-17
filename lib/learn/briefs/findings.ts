import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Findings added to a research brief after its run (learn.brief_findings):
 * what another chat found and asked Dash to add with add_to_brief
 * (lib/dash/learn-writes.ts). The run never writes here, so running a brief
 * again keeps them. Each sits under the sub-question it answers on the
 * brief's page, or under Added findings when it answers none.
 */

/** The longest finding kept, a few paragraphs. */
export const FINDING_MAX = 4_000;
/** The most sources one finding rests on. */
export const FINDING_SOURCES_MAX = 6;
/** The longest quote kept from one source. */
export const FINDING_QUOTE_MAX = 1_000;

/** A source a finding rests on: its title, its link and the words quoted from it. */
export type FindingSource = { title: string; url: string; quote: string };

export type BriefFinding = {
  id: string;
  /** The sub-question it answers, or null for one that answers none. */
  subQuestionId: string | null;
  body: string;
  sources: FindingSource[];
  createdAt: string;
};

type Row = { id: string; sub_question_id: string | null; body: string; sources: unknown; created_at: string };

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readFindingSources(raw: unknown): FindingSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const title = str(source.title);
    const url = str(source.url);
    if (!title || !url.startsWith('https://')) return [];
    return [{ title, url, quote: str(source.quote) }];
  });
}

export function toFinding(row: Row): BriefFinding {
  return {
    id: row.id,
    subQuestionId: row.sub_question_id || null,
    body: row.body,
    sources: readFindingSources(row.sources),
    createdAt: row.created_at,
  };
}

/** A brief's findings, oldest first. Row level security keeps them to the person's own. */
export async function loadFindings(supabase: LearnSupabaseClient, briefId: string): Promise<BriefFinding[]> {
  const { data, error } = await supabase
    .from('brief_findings')
    .select('id, sub_question_id, body, sources, created_at')
    .eq('brief_id', briefId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`Could not read the brief's added findings: ${error.message}`);
  return ((data ?? []) as Row[]).map(toFinding);
}

/**
 * The findings by the sub-question they answer, and the rest: a finding whose
 * sub-question the brief no longer has (a later run chose new ones) joins the rest.
 */
export function groupFindings(
  findings: readonly BriefFinding[],
  subQuestionIds: readonly string[],
): { bySub: Map<string, BriefFinding[]>; other: BriefFinding[] } {
  const known = new Set(subQuestionIds);
  const bySub = new Map<string, BriefFinding[]>();
  const other: BriefFinding[] = [];
  for (const finding of findings) {
    if (finding.subQuestionId && known.has(finding.subQuestionId)) {
      bySub.set(finding.subQuestionId, [...(bySub.get(finding.subQuestionId) ?? []), finding]);
    } else {
      other.push(finding);
    }
  }
  return { bySub, other };
}
