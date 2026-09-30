/**
 * Storing what a search found, shared by the live search (run.ts) and the
 * batch collector (search-batch.ts), so a role or a person is written the
 * same way however long its search took.
 *
 * The `*Taken` loaders rebuild what a search must not suggest again at the
 * moment its result is stored: a batch can finish an hour after it was sent,
 * and anything saved, applied for or turned down in that hour counts.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { companyKey, personKey, roleKey, type OpeningSuggestion, type PersonSuggestion } from './payload';
import { SUGGEST_MODEL } from './model';

/** A followed-board posting offered to a search: a role found at this link came from that board. */
export type BoardOrigin = { url: string; company: string };

type Row = Record<string, unknown>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Store found roles. Returns "Title at Company" for each written; a duplicate link is skipped. */
export async function storeOpenings(
  supabase: AppSupabaseClient,
  userId: string,
  openings: readonly OpeningSuggestion[],
  boards: readonly BoardOrigin[],
): Promise<string[]> {
  const fromBoard = new Map(boards.map((board) => [board.url, board.company]));
  const headlines: string[] = [];
  for (const opening of openings) {
    const board = fromBoard.get(opening.url);
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'apply',
      origin: board ? 'board' : 'search',
      found_in: board ? `On ${board}'s own job board` : null,
      company_name: opening.company,
      headline: opening.title,
      why: opening.why,
      move: opening.move,
      url: opening.url,
      location: opening.location,
      model: SUGGEST_MODEL,
    });
    if (!error) headlines.push(`${opening.title} at ${opening.company}`);
    // 23505: the link was suggested already, by a goal step or an earlier run.
    else if (error.code !== '23505') console.error('[jobs suggestions] apply insert', error.message);
  }
  return headlines;
}

/** Store found people. Returns each headline written; a person already recommended is skipped. */
export async function storePeople(
  supabase: AppSupabaseClient,
  userId: string,
  people: readonly PersonSuggestion[],
): Promise<string[]> {
  const headlines: string[] = [];
  for (const suggestion of people) {
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'reach_out',
      origin: 'search',
      company_name: suggestion.company,
      person_name: suggestion.personName,
      person_title: suggestion.personTitle,
      source_url: suggestion.sourceUrl,
      search_query: suggestion.searchQuery,
      headline: suggestion.headline,
      why: suggestion.why,
      move: suggestion.move,
      channel: suggestion.channel,
      message: suggestion.message,
      model: SUGGEST_MODEL,
    });
    if (!error) headlines.push(suggestion.headline);
    // 23505: a goal step already recommended this person.
    else if (error.code !== '23505') console.error('[jobs suggestions] reach_out insert', error.message);
  }
  return headlines;
}

async function excludedIndustries(supabase: AppSupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase.from('profiles').select('excluded_industries').eq('id', userId).maybeSingle();
  return ((data as Row | null)?.excluded_industries as string[] | undefined) ?? [];
}

/** What a roles search must not suggest: links already suggested or applied for, roles on file, companies turned down. */
export async function openingsTaken(supabase: AppSupabaseClient, userId: string) {
  const [past, applications, excluded] = await Promise.all([
    supabase.from('suggestions').select('url, status, dismiss_reason, company_name').eq('user_id', userId).eq('kind', 'apply').limit(2000),
    supabase
      .from('applications')
      .select('roles ( title, jd_url, companies ( name ) )')
      .eq('user_id', userId)
      .limit(1000),
    excludedIndustries(supabase, userId),
  ]);
  if (past.error) throw new Error(`Reading the earlier suggestions failed: ${past.error.message}`);
  if (applications.error) throw new Error(`Reading the applications failed: ${applications.error.message}`);
  const urls = new Set<string>();
  const roles = new Set<string>();
  const companies = new Set<string>();
  for (const row of (past.data ?? []) as Row[]) {
    if (row.url) urls.add(row.url as string);
    if (row.status === 'dismissed' && row.dismiss_reason === 'company' && row.company_name) {
      companies.add(companyKey(row.company_name as string));
    }
  }
  for (const row of (applications.data ?? []) as Row[]) {
    const role = one(row.roles as Row | Row[] | null);
    if (!role) continue;
    if (role.jd_url) urls.add(role.jd_url as string);
    const company = one(role.companies as Row | Row[] | null);
    roles.add(roleKey((company?.name as string | undefined) ?? 'Unknown company', role.title as string));
  }
  return { urls, roles, companies, excludedIndustries: excluded };
}

/** What a people search must not suggest: contacts and people already suggested, by personKey. */
export async function peopleTaken(supabase: AppSupabaseClient, userId: string) {
  const [contacts, past, excluded] = await Promise.all([
    supabase.from('contacts').select('full_name').eq('user_id', userId).limit(2000),
    supabase.from('suggestions').select('person_name').eq('user_id', userId).not('person_name', 'is', null).limit(2000),
    excludedIndustries(supabase, userId),
  ]);
  if (contacts.error) throw new Error(`Reading the contacts failed: ${contacts.error.message}`);
  const people = new Set<string>([
    ...((contacts.data ?? []) as Row[]).map((row) => personKey(row.full_name as string)),
    ...((past.data ?? []) as Row[]).map((row) => personKey(row.person_name as string)),
  ]);
  return { people, excludedIndustries: excluded };
}
