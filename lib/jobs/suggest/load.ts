import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { SuggestionKind } from './cadence';
import { parseOpeningScores, SCORE_CONFIDENCE_FLOOR, type OpeningScores } from './scores';
import type { ScoreNote } from './score-notes';
import { preferenceMisses, readPreferences, type JobPreferences, type PostingWorkMode } from './preferences';
import { openingStats, type OpeningOutcome, type OriginStats } from './stats';

/** One open suggestion as Roles or Contacts shows it. */
export type OpenSuggestion = {
  id: string;
  kind: SuggestionKind;
  headline: string;
  why: string;
  move: string;
  channel: string | null;
  message: string | null;
  url: string | null;
  location: string | null;
  companyName: string | null;
  companySlug: string | null;
  personName: string | null;
  personTitle: string | null;
  sourceUrl: string | null;
  searchQuery: string | null;
  /** Where it was found, when not by the suggestion run's own search. */
  foundIn: string | null;
  contact: { id: string; name: string; email: string | null; linkedinUrl: string | null } | null;
  /** Jev's answers on an opening (plans #1178, #1202); null until it has been scored. */
  scores: OpeningScores | null;
  /** Fit and chance with their reasons (plan #1206), attached by the Find page (`withOpeningNotes`). */
  scoreNote?: ScoreNote | null;
  /** Who found it (job_search 0039): the web search, a followed board or a goals run. */
  origin: string;
  /** Whether the posting has been read from its link (posting.ts). */
  postingRead: boolean;
  compMaxCents: number | null;
  workMode: PostingWorkMode | null;
  /** Where the posting falls outside the preferences, attached by the Find page (`withPreferenceMisses`). */
  misses?: string[];
  createdAt: string;
};

type Row = {
  id: string;
  kind: SuggestionKind;
  headline: string;
  why: string;
  move: string;
  channel: string | null;
  message: string | null;
  url: string | null;
  location: string | null;
  company_name: string | null;
  person_name: string | null;
  person_title: string | null;
  source_url: string | null;
  search_query: string | null;
  found_in: string | null;
  scores: unknown;
  origin: string | null;
  posting_status: string | null;
  comp_max_cents: number | string | null;
  work_mode: string | null;
  created_at: string;
  contacts: { id: string; full_name: string; email: string | null; linkedin_url: string | null } | null;
  companies: { name: string; slug: string } | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** The open suggestions of one kind, newest first. */
export async function loadOpenSuggestions(
  supabase: AppSupabaseClient,
  userId: string,
  kind: SuggestionKind,
): Promise<OpenSuggestion[]> {
  const { data, error } = await supabase
    .from('suggestions')
    .select(
      'id, kind, headline, why, move, channel, message, url, location, company_name, person_name, person_title, source_url, search_query, found_in, scores, origin, posting_status, comp_max_cents, work_mode, created_at, contacts ( id, full_name, email, linkedin_url ), companies ( name, slug )',
    )
    .eq('user_id', userId)
    .eq('status', 'open')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(50);
  // A missing table or a failed read hides the section rather than the page.
  if (error) return [];

  return ((data ?? []) as unknown as Row[])
    .map((row) => {
      const contact = one(row.contacts);
      const company = one(row.companies);
      return {
        id: row.id,
        kind: row.kind,
        headline: row.headline,
        why: row.why,
        move: row.move,
        channel: row.channel,
        message: row.message,
        url: row.url,
        location: row.location,
        companyName: company?.name ?? row.company_name,
        companySlug: company?.slug ?? null,
        personName: row.person_name,
        personTitle: row.person_title,
        sourceUrl: row.source_url,
        searchQuery: row.search_query,
        foundIn: row.found_in,
        contact: contact
          ? { id: contact.id, name: contact.full_name, email: contact.email, linkedinUrl: contact.linkedin_url }
          : null,
        scores: parseOpeningScores(row.scores),
        origin: row.origin ?? 'goal',
        postingRead: row.posting_status === 'open',
        compMaxCents: row.comp_max_cents === null ? null : Number(row.comp_max_cents),
        workMode: (['onsite', 'hybrid', 'remote'] as const).find((mode) => mode === row.work_mode) ?? null,
        createdAt: row.created_at,
      };
    });
}

/** What the person wants from a job, from /jobs/settings. A failed read is none set. */
export async function loadJobPreferences(supabase: AppSupabaseClient, userId: string): Promise<JobPreferences> {
  const { data } = await supabase
    .from('profiles')
    .select('home_location, workplace_preferences, salary_floor_cents, company_stages')
    .eq('id', userId)
    .maybeSingle();
  return readPreferences(data as Record<string, unknown> | null);
}

/** The openings with where each falls outside the preferences. */
export function withPreferenceMisses(suggestions: OpenSuggestion[], prefs: JobPreferences): OpenSuggestion[] {
  return suggestions.map((suggestion) => {
    const workplace = suggestion.scores?.workplace;
    const sureWorkplace =
      workplace && workplace.confidence >= SCORE_CONFIDENCE_FLOOR && workplace.value !== 'unclear' ? workplace.value : null;
    return {
      ...suggestion,
      misses: preferenceMisses(
        { compMaxCents: suggestion.compMaxCents, workMode: suggestion.workMode, workplaceAnswer: sureWorkplace },
        prefs,
      ),
    };
  });
}

type OutcomeRow = {
  origin: string | null;
  status: string;
  roles: {
    applications:
      | { status: string; rejection_stage: string | null; rejection_stage_override: string | null; interviews: { id: string }[] | null }[]
      | null;
  } | null;
};

/**
 * Each source's record, for the line under the recommended roles
 * (stats.ts). A failed read shows no line rather than failing the page.
 */
export async function loadOpeningStats(supabase: AppSupabaseClient, userId: string): Promise<OriginStats[]> {
  const { data, error } = await supabase
    .from('suggestions')
    .select(
      'origin, status, roles ( applications ( status, rejection_stage, rejection_stage_override, interviews ( id ) ) )',
    )
    .eq('user_id', userId)
    .eq('kind', 'apply')
    .limit(2000);
  if (error) return [];
  const rows: OpeningOutcome[] = ((data ?? []) as unknown as OutcomeRow[]).map((row) => {
    const role = one(row.roles);
    const app = role?.applications?.[0] ?? null;
    return {
      origin: row.origin,
      status: row.status,
      application: app
        ? {
            status: app.status,
            rejectionStage: app.rejection_stage_override ?? app.rejection_stage,
            hasInterview: (app.interviews ?? []).length > 0,
          }
        : null,
    };
  });
  return openingStats(rows);
}
