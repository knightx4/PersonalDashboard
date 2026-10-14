import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  foundKind,
  parseSubQuestions,
  toBrief,
  type BriefPage,
  type BriefRow,
  type BriefSource,
  type BriefStatus,
  type BriefSummary,
} from './view';

/**
 * Reads for the brief page and Learn's list of open briefs (plan #2023.4).
 * Row-level security limits every read to the signed-in person's own briefs.
 */

const BRIEF_COLUMNS =
  'id, track_id, question, angle, depth, sub_questions, status, stage, error, sections, short_answer, short_answer_by, watch_on, watched_at, archived_at, created_at, updated_at, tracks!briefs_track_fk ( title )';

type SourceRow = {
  id: string;
  title: string | null;
  found_kind: string | null;
  found_at: string | null;
  open_url: string | null;
  sources: { title: string | null; year: number | null; canonical_url: string | null } | null;
};

function toSource(row: SourceRow): BriefSource {
  const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
  return {
    readingId: row.id,
    title: source?.title ?? row.title ?? 'Untitled source',
    kind: foundKind(row.found_kind),
    year: source?.year ?? null,
    foundAt: row.found_at,
    url: row.open_url ?? source?.canonical_url ?? null,
  };
}

/** One brief and the readings its run found, or null when it is not theirs or not there. */
export async function loadBrief(supabase: LearnSupabaseClient, id: string): Promise<BriefPage | null> {
  const [brief, readings] = await Promise.all([
    supabase.from('briefs').select(BRIEF_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('readings')
      .select('id, title, found_kind, found_at, open_url, sources ( title, year, canonical_url )')
      .eq('brief_id', id)
      .order('position'),
  ]);
  if (brief.error) throw new Error(`Could not read the brief: ${brief.error.message}`);
  if (!brief.data) return null;
  if (readings.error) throw new Error(`Could not read the brief's sources: ${readings.error.message}`);
  const sources: Record<string, BriefSource> = {};
  for (const row of (readings.data ?? []) as unknown as SourceRow[]) sources[row.id] = toSource(row);
  return { brief: toBrief(brief.data as unknown as BriefRow), sources };
}

/** The briefs not archived, newest first, for Learn's home. */
export async function loadOpenBriefs(supabase: LearnSupabaseClient, limit = 10): Promise<BriefSummary[]> {
  const { data, error } = await supabase
    .from('briefs')
    .select('id, question, status, sub_questions, updated_at')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read your research topics: ${error.message}`);
  return ((data ?? []) as { id: string; question: string; status: string; sub_questions: unknown; updated_at: string }[]).map(
    (row) => ({
      id: row.id,
      question: row.question,
      status: (['researching', 'ready', 'failed'].includes(row.status) ? row.status : 'researching') as BriefStatus,
      subQuestions: parseSubQuestions(row.sub_questions).length,
      updatedAt: row.updated_at,
    }),
  );
}

/** The brief that made a reading list, for the list's link back to it. */
export async function loadBriefForTrack(
  supabase: LearnSupabaseClient,
  trackId: string,
): Promise<{ id: string; question: string } | null> {
  const { data, error } = await supabase
    .from('briefs')
    .select('id, question')
    .eq('track_id', trackId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string; question: string } | null) ?? null;
}
