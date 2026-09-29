import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { SuggestionKind } from './cadence';
import { parseOpeningScores, type OpeningScores } from './scores';

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
      'id, kind, headline, why, move, channel, message, url, location, company_name, person_name, person_title, source_url, search_query, found_in, scores, created_at, contacts ( id, full_name, email, linkedin_url ), companies ( name, slug )',
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
        createdAt: row.created_at,
      };
    });
}
