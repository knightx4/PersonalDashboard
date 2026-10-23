import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { toFunnelApplications, type PipelineRow } from '@/lib/jobs/applications/load';
import { funnelMetrics } from '@/lib/jobs/pipeline';
import { buildFunnel, FUNNEL_WINDOW_DAYS, type FunnelSuggestionInput, type FunnelView } from './funnel';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads what the funnel needs beyond the pipeline the page already holds:
 * Dash's suggestions, the interviews held in the window and the size of the
 * watchlist. A failed read leaves its part empty rather than failing Now.
 */
export async function loadFunnel(
  supabase: AppSupabaseClient,
  userId: string,
  pipeline: readonly PipelineRow[],
  now: Date,
): Promise<FunnelView> {
  // Twice the window, so a suggestion made before it and taken inside it counts.
  const since = new Date(now.getTime() - FUNNEL_WINDOW_DAYS * DAY_MS).toISOString();
  const lookback = new Date(now.getTime() - 2 * FUNNEL_WINDOW_DAYS * DAY_MS).toISOString();

  const [suggestions, interviews, watchlist] = await Promise.all([
    supabase
      .from('suggestions')
      .select('id, headline, company_name, person_name, status, created_at, acted_at, companies ( name )')
      .eq('user_id', userId)
      .or(`status.eq.open,created_at.gte.${lookback}`)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('interviews')
      .select('application_id, scheduled_at')
      .eq('user_id', userId)
      .gte('scheduled_at', since)
      .lte('scheduled_at', now.toISOString()),
    supabase.from('watchlist_startups').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  type SuggestionRow = {
    id: string;
    headline: string | null;
    company_name: string | null;
    person_name: string | null;
    status: string;
    created_at: string;
    acted_at: string | null;
    companies: { name: string } | { name: string }[] | null;
  };
  const companyName = (row: SuggestionRow) =>
    (Array.isArray(row.companies) ? row.companies[0]?.name : row.companies?.name) ?? row.company_name;

  const suggestionRows: FunnelSuggestionInput[] = suggestions.error
    ? []
    : ((suggestions.data ?? []) as unknown as SuggestionRow[]).map((row) => ({
        id: row.id,
        name: companyName(row) ?? row.person_name ?? 'Suggestion',
        headline: row.headline ?? '',
        status: row.status,
        createdAt: row.created_at,
        actedAt: row.acted_at,
      }));

  return buildFunnel({
    now,
    applications: pipeline,
    suggestions: suggestionRows,
    interviewsHeld: interviews.error
      ? []
      : (interviews.data ?? []).map((row) => ({
          applicationId: row.application_id as string,
          scheduledAt: row.scheduled_at as string,
        })),
    watched: watchlist.error ? null : (watchlist.count ?? null),
    replyRate: funnelMetrics(toFunnelApplications(pipeline), { now }).responseRate,
  });
}
