import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { RequirementMatch } from '../evidence/match-payload';
import { parseApplicationScores } from './application-scores';
import { reachedInterview, type PastApplication } from './history';
import type { OpenSuggestion } from './load';
import { scoreNote, type ScoreNote } from './score-notes';

/**
 * Reading the fit and chance notes for the Roles table, the pipeline cards
 * and the recommended openings (plan #1206).
 *
 * The history the reasons read is the pipeline the page has already loaded,
 * so this costs one small query: the scored applications with the three role
 * fields their reasons need.
 */

/** The pipeline as the history the reasons read. */
export function historyFromPipeline(rows: readonly PipelineRow[]): PastApplication[] {
  return rows.map((row) => ({
    id: row.applicationId,
    title: row.roleTitle,
    company: row.companyName,
    status: row.status,
    rejectionStage: row.rejectionStage,
    hasInterview: (row.interviewKinds ?? []).length > 0,
  }));
}

type Row = {
  id: string;
  scores: unknown;
  roles: { seniority: string | null; jd_text: string | null; requirement_matches: unknown } | null;
};

/** Each scored application's note, by application id. A failed read leaves the rows without notes. */
export async function loadApplicationNotes(
  supabase: AppSupabaseClient,
  userId: string,
  rows: readonly PipelineRow[],
): Promise<Map<string, ScoreNote>> {
  const notes = new Map<string, ScoreNote>();
  const { data, error } = await supabase
    .from('applications')
    .select('id, scores, roles!inner ( seniority, jd_text, requirement_matches )')
    .eq('user_id', userId)
    .not('scores', 'is', null);
  if (error || !data) return notes;

  const history = historyFromPipeline(rows);
  const byId = new Map(history.map((app) => [app.id, app]));
  for (const row of data as unknown as Row[]) {
    const scores = parseApplicationScores(row.scores);
    const app = byId.get(row.id);
    const role = Array.isArray(row.roles) ? (row.roles[0] ?? null) : row.roles;
    if (!scores || !app || !role) continue;
    const note = scoreNote(
      {
        kind: 'application',
        title: app.title,
        scores,
        seniority: role.seniority,
        requirementMatches: Array.isArray(role.requirement_matches)
          ? (role.requirement_matches as RequirementMatch[])
          : null,
        hasDescription: (role.jd_text ?? '').trim().length > 0,
        history,
        excludeId: app.id,
      },
      { interviewed: reachedInterview(app) },
    );
    if (note) notes.set(row.id, note);
  }
  return notes;
}

/** The pipeline rows with their notes attached. */
export async function withApplicationNotes(
  supabase: AppSupabaseClient,
  userId: string,
  rows: PipelineRow[],
): Promise<PipelineRow[]> {
  const notes = await loadApplicationNotes(supabase, userId, rows);
  if (notes.size === 0) return rows;
  return rows.map((row) => ({ ...row, scoreNote: notes.get(row.applicationId) ?? null }));
}

/** The recommended openings with their notes, read against the same history. */
export function withOpeningNotes(suggestions: OpenSuggestion[], history: readonly PastApplication[]): OpenSuggestion[] {
  return suggestions.map((suggestion) => ({
    ...suggestion,
    scoreNote: suggestion.scores
      ? scoreNote({ kind: 'opening', title: suggestion.headline, scores: suggestion.scores, history })
      : null,
  }));
}
