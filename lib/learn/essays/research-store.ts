import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  forBrowser,
  NO_RESEARCH,
  researchFromRow,
  type EssayResearch,
  type EssayResearchRuns,
  type ResearchClaim,
  type ResearchLevel,
  type ResearchPosition,
  type ResearchRow,
  type ResearchSource,
} from './research';

/**
 * Reads and writes on `learn.essay_research` (plan #1863.9), through the
 * person's own session so RLS decides which rows are theirs. A run is
 * written once, when it comes back; nothing updates it after.
 */

const COLUMNS = 'id, level, question, queries, sources, findings, cost_micros, created_at';

/** The newest run of each level, for the essay page. The pages' kept text stays on the server. */
export async function loadEssayResearch(supabase: LearnSupabaseClient, essayId: string): Promise<EssayResearchRuns> {
  const runs: EssayResearchRuns = { ...NO_RESEARCH };
  for (const level of ['first', 'deeper'] as const) {
    const { data, error } = await supabase
      .from('essay_research')
      .select(COLUMNS)
      .eq('essay_id', essayId)
      .eq('level', level)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`learn: reading the essay's research failed (${error.message})`);
    const run = data ? researchFromRow(data as ResearchRow) : null;
    runs[level] = run ? forBrowser(run) : null;
  }
  return runs;
}

export async function insertEssayResearch(
  supabase: LearnSupabaseClient,
  userId: string,
  essayId: string,
  run: {
    level: ResearchLevel;
    question: string;
    queries: string[];
    sources: ResearchSource[];
    findings: ResearchPosition[] | ResearchClaim[];
    costMicros: number | null;
    model: string;
  },
): Promise<EssayResearch> {
  const { data, error } = await supabase
    .from('essay_research')
    .insert({
      user_id: userId,
      essay_id: essayId,
      level: run.level,
      question: run.question,
      queries: run.queries,
      sources: run.sources,
      findings: run.findings,
      cost_micros: run.costMicros,
      model: run.model,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`learn: saving the research failed (${error?.message ?? 'no row'})`);
  const saved = researchFromRow(data as ResearchRow);
  if (!saved) throw new Error('learn: the saved research could not be read back');
  return forBrowser(saved);
}
