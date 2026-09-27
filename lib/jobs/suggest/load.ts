import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { SuggestionKind } from './cadence';

/** One open suggestion as This week shows it. */
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
  contact: { id: string; name: string; email: string | null; linkedinUrl: string | null } | null;
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
  created_at: string;
  contacts: { id: string; full_name: string; email: string | null; linkedin_url: string | null } | null;
  companies: { name: string; slug: string } | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** The open suggestions, newest first, people before postings. */
export async function loadOpenSuggestions(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<OpenSuggestion[]> {
  const { data, error } = await supabase
    .from('suggestions')
    .select(
      'id, kind, headline, why, move, channel, message, url, location, company_name, created_at, contacts ( id, full_name, email, linkedin_url ), companies ( name, slug )',
    )
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);
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
        contact: contact
          ? { id: contact.id, name: contact.full_name, email: contact.email, linkedinUrl: contact.linkedin_url }
          : null,
        createdAt: row.created_at,
      };
    })
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'reach_out' ? -1 : 1));
}
