/**
 * One person's suggestion run: read, ask, store.
 *
 * Called by the daily cron for every account (inngest/jobs/suggestions.ts)
 * with a service client, and by the buttons on This week with the person's
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
import { pickReachOutCandidates, type ApplicationFact, type ContactFact, type PastSuggestion } from './candidates';
import { suggestionDue, type SuggestionKind } from './cadence';
import { findOpenings, suggestOutreach, SUGGEST_MODEL, type SeekerContext } from './model';
import { roleKey } from './payload';

export type KindOutcome = {
  /** False when the cadence said not yet and nothing was asked. */
  ran: boolean;
  written: number;
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
      .select('display_name, timezone, target_titles, writing_style_notes, banned_constructions')
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
  };
}

type AppRow = {
  id: string;
  status: string;
  submitted_at: string | null;
  first_human_response_at: string | null;
  roles: {
    title: string;
    location: string | null;
    jd_url: string | null;
    company_id: string;
    companies: { name: string } | { name: string }[] | null;
  } | null;
};

async function loadApplications(supabase: AppSupabaseClient, userId: string) {
  const [apps, events] = await Promise.all([
    supabase
      .from('applications')
      .select('id, status, submitted_at, first_human_response_at, roles ( title, location, jd_url, company_id, companies ( name ) )')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('application_events')
      .select('application_id, occurred_at, summary')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(1500),
  ]);
  if (apps.error) throw new Error(`Reading the applications failed: ${apps.error.message}`);
  const latest = new Map<string, { at: string; summary: string | null }>();
  for (const event of (events.data ?? []) as Row[]) {
    const id = event.application_id as string;
    if (!latest.has(id)) latest.set(id, { at: event.occurred_at as string, summary: (event.summary as string | null) ?? null });
  }
  const rows = (apps.data ?? []) as unknown as AppRow[];
  const facts: (ApplicationFact & { respondedAt: string | null; location: string | null; url: string | null })[] = [];
  for (const row of rows) {
    const role = one(row.roles);
    if (!role) continue;
    const last = latest.get(row.id);
    facts.push({
      companyId: role.company_id,
      companyName: one(role.companies)?.name ?? 'Unknown company',
      roleTitle: role.title,
      status: row.status,
      submittedAt: row.submitted_at,
      lastEventAt: last?.at ?? null,
      lastEventSummary: last?.summary ?? null,
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
    .select('kind, status, contact_id, company_id, url, created_at, acted_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Reading the earlier suggestions failed: ${error.message}`);
  return (data ?? []) as Row[];
}

function kindState(past: Row[], kind: SuggestionKind) {
  const rows = past.filter((row) => row.kind === kind);
  return {
    lastRunAt: (rows[0]?.created_at as string | undefined) ?? null,
    open: rows.filter((row) => row.status === 'open').length,
  };
}

async function runReachOut(
  supabase: AppSupabaseClient,
  userId: string,
  apiKey: string,
  seeker: SeekerContext,
  applications: ApplicationFact[],
  past: Row[],
): Promise<KindOutcome> {
  const spend: SpendReport[] = [];
  const [contacts, touches] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, full_name, title, relationship, status, how_we_connect, notes, company_id, email, linkedin_url')
      .eq('user_id', userId)
      .limit(1000),
    supabase
      .from('contact_touches')
      .select('contact_id, sent_at')
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false })
      .limit(2000),
  ]);
  if (contacts.error) throw new Error(`Reading the contacts failed: ${contacts.error.message}`);
  const lastTouch = new Map<string, string>();
  for (const touch of (touches.data ?? []) as Row[]) {
    const id = touch.contact_id as string;
    if (!lastTouch.has(id)) lastTouch.set(id, touch.sent_at as string);
  }
  const contactFacts: ContactFact[] = ((contacts.data ?? []) as Row[]).map((row) => ({
    id: row.id as string,
    name: row.full_name as string,
    title: (row.title as string | null) ?? null,
    relationship: row.relationship as string,
    status: row.status as string,
    howWeConnect: (row.how_we_connect as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    hasEmail: !!row.email,
    hasLinkedin: !!row.linkedin_url,
    lastTouchAt: lastTouch.get(row.id as string) ?? null,
  }));
  const pastFacts: PastSuggestion[] = past.map((row) => ({
    kind: row.kind as string,
    status: row.status as string,
    contactId: (row.contact_id as string | null) ?? null,
    companyId: (row.company_id as string | null) ?? null,
    createdAt: row.created_at as string,
    actedAt: (row.acted_at as string | null) ?? null,
  }));

  const candidates = pickReachOutCandidates({ contacts: contactFacts, applications, past: pastFacts });
  if (candidates.length === 0) return { ran: true, written: 0, spend, error: null };

  const result = await suggestOutreach(
    { apiKey, onSpend: (report) => spend.push(report) },
    { seeker, candidates },
  );
  if (!result.ok) return { ran: true, written: 0, spend, error: result.error };

  let written = 0;
  for (const suggestion of result.suggestions) {
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'reach_out',
      contact_id: suggestion.candidate.contactId,
      company_id: suggestion.candidate.companyId,
      company_name: suggestion.candidate.companyName,
      headline: suggestion.headline,
      why: suggestion.why,
      move: suggestion.move,
      channel: suggestion.channel,
      message: suggestion.message,
      model: SUGGEST_MODEL,
    });
    if (!error) written += 1;
    else if (error.code !== '23505') console.error('[jobs suggestions] reach_out insert', error.message);
  }
  return { ran: true, written, spend, error: null };
}

async function runApply(
  supabase: AppSupabaseClient,
  userId: string,
  apiKey: string,
  seeker: SeekerContext,
  applications: Awaited<ReturnType<typeof loadApplications>>,
  past: Row[],
): Promise<KindOutcome> {
  const spend: SpendReport[] = [];
  const label = (app: ApplicationFact) => `${app.roleTitle} at ${app.companyName}`;
  const locations = new Map<string, number>();
  for (const app of applications.slice(0, 80)) {
    if (app.location) locations.set(app.location, (locations.get(app.location) ?? 0) + 1);
  }

  const result = await findOpenings(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      seeker,
      responded: applications.filter((app) => app.respondedAt).map(label),
      recent: applications.slice(0, 40).map(label),
      locations: [...locations.entries()].sort((a, b) => b[1] - a[1]).map(([place]) => place),
      taken: {
        urls: new Set(
          [...past.map((row) => row.url as string | null), ...applications.map((app) => app.url)].filter(
            (url): url is string => !!url,
          ),
        ),
        roles: new Set(applications.map((app) => roleKey(app.companyName, app.roleTitle))),
      },
    },
  );
  if (!result.ok) return { ran: true, written: 0, spend, error: result.error };

  let written = 0;
  for (const opening of result.suggestions) {
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      kind: 'apply',
      company_name: opening.company,
      headline: opening.title,
      why: opening.why,
      move: opening.move,
      url: opening.url,
      location: opening.location,
      model: SUGGEST_MODEL,
    });
    if (!error) written += 1;
    else if (error.code !== '23505') console.error('[jobs suggestions] apply insert', error.message);
  }
  return { ran: true, written, spend, error: null };
}

const SKIPPED: KindOutcome = { ran: false, written: 0, spend: [], error: null };

/**
 * Run the kinds asked for. `force` skips the cadence, for a press of the
 * button; the cron leaves it off and each kind runs only when it is due.
 */
export async function runSuggestionsFor(
  supabase: AppSupabaseClient,
  userId: string,
  options: { apiKey: string; kinds: readonly SuggestionKind[]; force?: boolean; now?: Date },
): Promise<Record<SuggestionKind, KindOutcome>> {
  const past = await loadPast(supabase, userId);
  const due = (kind: SuggestionKind) =>
    options.kinds.includes(kind) && (options.force || suggestionDue(kind, kindState(past, kind), options.now));

  const out: Record<SuggestionKind, KindOutcome> = { reach_out: SKIPPED, apply: SKIPPED };
  if (!due('reach_out') && !due('apply')) return out;

  const [seeker, applications] = await Promise.all([loadSeeker(supabase, userId), loadApplications(supabase, userId)]);
  // With nothing written about the job they want and nothing applied for,
  // there is nothing to suggest from.
  if (seeker.goals.length === 0 && seeker.targetTitles.length === 0 && applications.length === 0) {
    return out;
  }

  if (due('reach_out')) out.reach_out = await runReachOut(supabase, userId, options.apiKey, seeker, applications, past);
  if (due('apply')) out.apply = await runApply(supabase, userId, options.apiKey, seeker, applications, past);
  return out;
}
