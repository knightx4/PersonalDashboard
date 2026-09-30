/**
 * One person's suggestion run: read, ask, store.
 *
 * Called by the daily cron for every account (inngest/jobs/suggestions.ts)
 * with a service client, and by the search buttons on Roles and Contacts with the person's
 * own. Every read names the person, so the service client's missing RLS
 * changes nothing.
 *
 * The spend is handed back rather than written here, so each caller records it
 * under the operation its own press or clock names.
 */
import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { formatDate } from '@/lib/jobs/applications/load';
import { CAPPED_ORIGINS, cadenceState, STALE_DAYS, suggestionDue, type SuggestionKind } from './cadence';
import { findOpenings, findPeople, SUGGEST_MODEL, type SeekerContext } from './model';
import { exclusionWords, personKey, roleKey } from './payload';
import { openingFeedback } from './feedback';
import { pickBoardCandidates } from './board-pick';
import { loadFollowedBoardPostings } from './boards';
import { readPreferences } from './preferences';

export type KindOutcome = {
  /** False when the cadence said not yet and nothing was asked. */
  ran: boolean;
  written: number;
  /** The headlines of what was written, for the notification. */
  headlines: string[];
  spend: SpendReport[];
  error: string | null;
};

type Row = Record<string, unknown>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadSeeker(supabase: AppSupabaseClient, userId: string): Promise<SeekerContext> {
  const [profile, thoughts, resume] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'display_name, timezone, target_titles, writing_style_notes, banned_constructions, excluded_industries, home_location, workplace_preferences, salary_floor_cents, company_stages',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('thoughts')
      .select('body, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('resume_versions')
      .select('text_content, is_default, created_at')
      .eq('user_id', userId)
      .not('text_content', 'is', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (thoughts.error) throw new Error(`Reading the career goals failed: ${thoughts.error.message}`);
  const p = (profile.data ?? {}) as Row;
  const timezone = (p.timezone as string | undefined) ?? 'UTC';
  return {
    name: (p.display_name as string | null) ?? null,
    goals: ((thoughts.data ?? []) as Row[]).map((row) => ({
      written: formatDate(row.created_at as string, timezone),
      body: row.body as string,
    })),
    targetTitles: (p.target_titles as string[] | undefined) ?? [],
    resume: ((resume.data as Row | null)?.text_content as string | null) ?? null,
    writingStyle: (p.writing_style_notes as string | null) ?? null,
    banned: (p.banned_constructions as string[] | undefined) ?? [],
    excludedIndustries: (p.excluded_industries as string[] | undefined) ?? [],
    preferences: readPreferences(p),
  };
}

/** An application as the postings search reads it. */
type ApplicationFact = {
  companyName: string;
  roleTitle: string;
  status: string;
  respondedAt: string | null;
  location: string | null;
  url: string | null;
};

type AppRow = {
  id: string;
  status: string;
  first_human_response_at: string | null;
  roles: {
    title: string;
    location: string | null;
    jd_url: string | null;
    companies: { name: string } | { name: string }[] | null;
  } | null;
};

async function loadApplications(supabase: AppSupabaseClient, userId: string): Promise<ApplicationFact[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, status, first_human_response_at, roles ( title, location, jd_url, companies ( name ) )')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Reading the applications failed: ${error.message}`);
  const facts: ApplicationFact[] = [];
  for (const row of (data ?? []) as unknown as AppRow[]) {
    const role = one(row.roles);
    if (!role) continue;
    facts.push({
      companyName: one(role.companies)?.name ?? 'Unknown company',
      roleTitle: role.title,
      status: row.status,
      respondedAt: row.first_human_response_at,
      location: role.location,
      url: role.jd_url,
    });
  }
  return facts;
}

async function loadPast(supabase: AppSupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('suggestions')
    .select('kind, status, origin, dismiss_reason, headline, contact_id, company_id, company_name, person_name, url, created_at, acted_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Reading the earlier suggestions failed: ${error.message}`);
  return (data ?? []) as Row[];
}

const SEARCHED_AT: Record<SuggestionKind, 'people_searched_at' | 'roles_searched_at'> = {
  reach_out: 'people_searched_at',
  apply: 'roles_searched_at',
};


/** Contacts who could introduce them: people they know, not recruiters or interviewers. */
const WARM = new Set(['friend', 'former_colleague', 'alum', 'second_degree']);

async function runReachOut(
  supabase: AppSupabaseClient,
  userId: string,
  apiKey: string,
  seeker: SeekerContext,
  past: Row[],
): Promise<KindOutcome> {
  const spend: SpendReport[] = [];
  const { data, error } = await supabase
    .from('contacts')
    .select('full_name, title, relationship, how_we_connect, companies ( name )')
    .eq('user_id', userId)
    .limit(1000);
  if (error) throw new Error(`Reading the contacts failed: ${error.message}`);
  const contacts = (data ?? []) as Row[];

  const describe = (row: Row) => {
    const company = one(row.companies as { name: string } | { name: string }[] | null)?.name;
    const how = row.how_we_connect ? ` (${row.how_we_connect as string})` : '';
    return `${row.full_name as string}${row.title ? `, ${row.title as string}` : ''}${company ? ` at ${company}` : ''}${how}`;
  };
  const suggested = past
    .filter((row) => row.kind === 'reach_out' && row.person_name)
    .map((row) => `${row.person_name as string}${row.company_name ? ` at ${row.company_name as string}` : ''}`);
  const known = [...contacts.map(describe), ...suggested];
  const taken = new Set([
    ...contacts.map((row) => personKey(row.full_name as string)),
    ...past.filter((row) => row.person_name).map((row) => personKey(row.person_name as string)),
  ]);

  const result = await findPeople(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      seeker,
      warm: contacts.filter((row) => WARM.has(row.relationship as string)).map(describe),
      known,
      taken,
    },
  );
  if (!result.ok) return { ran: true, written: 0, headlines: [], spend, error: result.error };

  const headlines: string[] = [];
  for (const suggestion of result.suggestions) {
    const { error: insertError } = await supabase.from('suggestions').insert({
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
    if (!insertError) headlines.push(suggestion.headline);
    // 23505: a goal step already recommended this person.
    else if (insertError.code !== '23505') console.error('[jobs suggestions] reach_out insert', insertError.message);
  }
  return { ran: true, written: headlines.length, headlines, spend, error: null };
}

async function runApply(
  supabase: AppSupabaseClient,
  userId: string,
  apiKey: string,
  seeker: SeekerContext,
  applications: ApplicationFact[],
  past: Row[],
): Promise<KindOutcome> {
  const spend: SpendReport[] = [];
  const label = (app: ApplicationFact) => `${app.roleTitle} at ${app.companyName}`;
  const pastOpenings = past.filter((row) => row.kind === 'apply');
  const feedback = openingFeedback(
    pastOpenings.map((row) => ({
      status: row.status as string,
      headline: (row.headline as string | null) ?? null,
      companyName: (row.company_name as string | null) ?? null,
      dismissReason: (row.dismiss_reason as string | null) ?? null,
    })),
  );
  const taken = {
    urls: new Set(
      [...past.map((row) => row.url as string | null), ...applications.map((app) => app.url)].filter(
        (url): url is string => !!url,
      ),
    ),
    roles: new Set(applications.map((app) => roleKey(app.companyName, app.roleTitle))),
    companies: feedback.companies,
  };
  const responded = applications.filter((app) => app.respondedAt);
  const boardOpenings = pickBoardCandidates(await loadFollowedBoardPostings(supabase, userId), {
    targetTitles: seeker.targetTitles,
    likedTitles: [
      ...pastOpenings.filter((row) => row.status === 'done' && row.headline).map((row) => row.headline as string),
      ...responded.map((app) => app.roleTitle),
    ],
    taken,
    excludedWords: exclusionWords(seeker.excludedIndustries),
  });
  const fromBoard = new Map(boardOpenings.map((posting) => [posting.url, posting]));
  const locations = new Map<string, number>();
  for (const app of applications.slice(0, 80)) {
    if (app.location) locations.set(app.location, (locations.get(app.location) ?? 0) + 1);
  }

  const result = await findOpenings(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      seeker,
      responded: responded.map(label),
      recent: applications.slice(0, 40).map(label),
      locations: [...locations.entries()].sort((a, b) => b[1] - a[1]).map(([place]) => place),
      feedback,
      boardOpenings,
      taken,
    },
  );
  if (!result.ok) return { ran: true, written: 0, headlines: [], spend, error: result.error };

  const headlines: string[] = [];
  for (const opening of result.suggestions) {
    const board = fromBoard.get(opening.url);
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'apply',
      origin: board ? 'board' : 'search',
      found_in: board ? `On ${board.company}'s own job board` : null,
      company_name: opening.company,
      headline: opening.title,
      why: opening.why,
      move: opening.move,
      url: opening.url,
      location: opening.location,
      model: SUGGEST_MODEL,
    });
    if (!error) headlines.push(`${opening.title} at ${opening.company}`);
    else if (error.code !== '23505') console.error('[jobs suggestions] apply insert', error.message);
  }
  return { ran: true, written: headlines.length, headlines, spend, error: null };
}

/**
 * Take recommended roles left open for STALE_DAYS off the list. A posting
 * that old has usually closed, and a list the person has not got to in three
 * weeks is not one they are reading. Its link stays on file, so it is not
 * suggested again.
 */
async function expireStaleOpenings(supabase: AppSupabaseClient, userId: string, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('suggestions')
    .update({ status: 'expired', expired_reason: 'stale', acted_at: now.toISOString() })
    .eq('user_id', userId)
    .eq('kind', 'apply')
    .eq('status', 'open')
    .lt('created_at', cutoff);
  if (error) console.error('[jobs suggestions] expire stale', error.message);
}

const SKIPPED: KindOutcome = { ran: false, written: 0, headlines: [], spend: [], error: null };

/**
 * Run the kinds asked for. `force` skips the cadence, for a press of the
 * button; the cron leaves it off and each kind runs only when it is due.
 */
export async function runSuggestionsFor(
  supabase: AppSupabaseClient,
  userId: string,
  options: { apiKey: string; kinds: readonly SuggestionKind[]; force?: boolean; now?: Date },
): Promise<Record<SuggestionKind, KindOutcome>> {
  if (options.kinds.includes('apply')) await expireStaleOpenings(supabase, userId, options.now);
  const [past, searched] = await Promise.all([
    loadPast(supabase, userId),
    supabase.from('profiles').select('people_searched_at, roles_searched_at').eq('id', userId).maybeSingle(),
  ]);
  const searchedRow = (searched.data ?? {}) as Row;
  const due = (kind: SuggestionKind) =>
    options.kinds.includes(kind) &&
    (options.force ||
      suggestionDue(
        kind,
        cadenceState(
          past
            // Goal finds are not the search's own, so they neither fill its
            // list nor mark when it last ran.
            .filter((row) => row.kind === kind && CAPPED_ORIGINS.includes(row.origin as string))
            .map((row) => ({ status: row.status as string, createdAt: row.created_at as string })),
          (searchedRow[SEARCHED_AT[kind]] as string | null) ?? null,
        ),
        options.now,
      ));

  const out: Record<SuggestionKind, KindOutcome> = { reach_out: SKIPPED, apply: SKIPPED };
  if (!due('reach_out') && !due('apply')) return out;

  const [seeker, applications] = await Promise.all([loadSeeker(supabase, userId), loadApplications(supabase, userId)]);
  // Both searches start from what they want: without career goals or target
  // titles there is nothing to search for, and a pipeline alone would only
  // bring back more of the same.
  if (seeker.goals.length === 0 && seeker.targetTitles.length === 0) return out;

  const record = async (kind: SuggestionKind, outcome: KindOutcome) => {
    // A failed call is retried on the next day; a run that finished, found
    // something or not, waits its interval.
    if (outcome.error) return;
    await supabase
      .from('profiles')
      .update({ [SEARCHED_AT[kind]]: new Date().toISOString() })
      .eq('id', userId);
  };

  if (due('reach_out')) {
    out.reach_out = await runReachOut(supabase, userId, options.apiKey, seeker, past);
    await record('reach_out', out.reach_out);
  }
  if (due('apply')) {
    out.apply = await runApply(supabase, userId, options.apiKey, seeker, applications, past);
    await record('apply', out.apply);
  }
  return out;
}
