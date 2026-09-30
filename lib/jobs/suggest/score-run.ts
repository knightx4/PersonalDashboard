import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { JEV_MODEL } from '@/lib/jev/wire';
import type { RequirementMatch } from '../evidence/match-payload';
import type { Requirement } from '../jd/requirements';
import { CLOSED_APPLICATION_STATUSES, scoreApplication } from './application-scores';
import type { PastApplication } from './history';
import { SCORE_CONFIDENCE_FLOOR, scoreOpening, type ScoringContext } from './scores';
import { readPreferences } from './preferences';

/**
 * Score the open recommended roles that have not been scored yet (plan #1178).
 *
 * Called after the daily suggestion run for every account that agreed to Jev,
 * and after the search button on Roles, so an opening from a goals run, which
 * writes its row in plain SQL, is scored on the next day's run. `rescore`
 * scores every open opening again, for a change to the questions.
 *
 * Every read names the person, so a service client works the same as theirs.
 * No `server-only` guard, so a script can run it under plain `tsx`.
 */

type Row = Record<string, unknown>;

/** At most this many in one run. A re-score of 100 cost $0.0076 on the trial. */
export const SCORE_LIMIT = 100;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * What Jev is told about the person: evidence titles, target titles, the
 * roles on file, and how each application went (for the chance question,
 * plan #1202). An application reached an interview when an interview row is
 * on file for it or its rejection stage comes after the screen; see
 * `reachedInterview` in history.ts.
 */
export async function loadScoringContext(supabase: AppSupabaseClient, userId: string): Promise<ScoringContext> {
  const [evidence, profile, applications] = await Promise.all([
    supabase
      .from('evidence_items')
      .select('title, strength')
      .eq('user_id', userId)
      .order('strength', { ascending: false })
      .limit(40),
    supabase
      .from('profiles')
      .select('target_titles, home_location, workplace_preferences, salary_floor_cents, company_stages')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('applications')
      .select(
        'id, status, rejection_stage, rejection_stage_override, created_at, roles ( title, companies ( name ) ), interviews ( id )',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (applications.error) throw new Error(`Reading the applications failed: ${applications.error.message}`);

  const roles: ScoringContext['roles'] = [];
  const history: PastApplication[] = [];
  for (const row of (applications.data ?? []) as Row[]) {
    const role = one(row.roles as Row | Row[] | null);
    if (!role) continue;
    const company = one(role.companies as Row | Row[] | null);
    roles.push({
      title: role.title as string,
      company: (company?.name as string | undefined) ?? null,
      status: row.status as string,
    });
    history.push({
      id: row.id as string,
      title: role.title as string,
      company: (company?.name as string | undefined) ?? null,
      status: row.status as string,
      rejectionStage: ((row.rejection_stage_override ?? row.rejection_stage) as string | null) ?? null,
      hasInterview: ((row.interviews as Row[] | null) ?? []).length > 0,
    });
  }
  return {
    evidence: ((evidence.data ?? []) as Row[]).map((row) => row.title as string),
    targetTitles: ((profile.data as Row | null)?.target_titles as string[] | undefined) ?? [],
    applied: roles
      .filter((role) => role.status !== 'lead')
      .map((role) => `${role.title} at ${role.company ?? 'an unnamed company'}`),
    roles,
    history,
    preferences: readPreferences(profile.data as Row | null),
  };
}

export type ScoreRunOutcome = {
  scored: number;
  /** Openings Jev could not score; they stay unscored for the next run. */
  failed: number;
  /** Why the run stopped early, when a failure means every other call would fail too. */
  stopped: string | null;
};

export async function scoreOpeningsFor(
  supabase: AppSupabaseClient,
  userId: string,
  options: { onSpend?: SpendSink; rescore?: boolean; limit?: number; apiKey?: string | null; fetch?: typeof fetch } = {},
): Promise<ScoreRunOutcome> {
  const outcome: ScoreRunOutcome = { scored: 0, failed: 0, stopped: null };
  let query = supabase
    .from('suggestions')
    .select('id, headline, company_name, location, why, move, posting_text, companies ( name )')
    .eq('user_id', userId)
    .eq('kind', 'apply')
    .eq('status', 'open');
  if (!options.rescore) query = query.is('scored_at', null);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? SCORE_LIMIT);
  if (error) throw new Error(`Reading the openings failed: ${error.message}`);
  const openings = (data ?? []) as Row[];
  if (openings.length === 0) return outcome;

  const context = await loadScoringContext(supabase, userId);
  for (const row of openings) {
    const company = one(row.companies as Row | Row[] | null);
    const result = await scoreOpening({
      opening: {
        title: row.headline as string,
        company: (company?.name as string | undefined) ?? (row.company_name as string | null),
        location: row.location as string | null,
        why: row.why as string,
        move: row.move as string,
        postingText: (row.posting_text as string | null) ?? null,
      },
      context,
      onSpend: options.onSpend,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
    if (!result.ok) {
      outcome.failed += 1;
      // A missing key, a refused key or TypeSafe asking for a pause fails the
      // rest the same way; stop and leave them for the next run.
      if (['no-key', 'refused', 'rate-limited', 'overloaded'].includes(result.reason)) {
        outcome.stopped = result.reason;
        break;
      }
      continue;
    }
    // A sure duplicate of a role already on file comes off the list: it is
    // one the person has already decided about.
    const duplicate = result.scores.duplicate;
    const expire =
      duplicate?.value && duplicate.confidence >= SCORE_CONFIDENCE_FLOOR
        ? { status: 'expired', expired_reason: 'duplicate', acted_at: new Date().toISOString() }
        : {};
    const { error: writeError } = await supabase
      .from('suggestions')
      .update({ scores: result.scores, scored_at: new Date().toISOString(), score_model: JEV_MODEL, ...expire })
      .eq('id', row.id as string)
      .eq('user_id', userId);
    if (writeError) outcome.failed += 1;
    else outcome.scored += 1;
  }
  return outcome;
}

/**
 * Score the open applications that have not been scored yet (plan #1203):
 * fit and the chance of an interview, the two numbers an opening carries.
 * Closed applications (rejected, withdrawn, ghosted, role closed) are never
 * read. A role whose description or requirement match changes has its
 * applications' `scored_at` cleared by a trigger (migration job_search 0038),
 * so they come back here on the next run. `rescore` scores every open one.
 */
export async function scoreApplicationsFor(
  supabase: AppSupabaseClient,
  userId: string,
  options: { onSpend?: SpendSink; rescore?: boolean; limit?: number; apiKey?: string | null; fetch?: typeof fetch } = {},
): Promise<ScoreRunOutcome> {
  const outcome: ScoreRunOutcome = { scored: 0, failed: 0, stopped: null };
  let query = supabase
    .from('applications')
    .select(
      'id, status, roles ( title, seniority, location, work_mode, comp_min_cents, comp_max_cents, requirements, requirement_matches, jd_text, companies ( name ) )',
    )
    .eq('user_id', userId)
    .not('status', 'in', `(${CLOSED_APPLICATION_STATUSES.join(',')})`);
  if (!options.rescore) query = query.is('scored_at', null);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(options.limit ?? SCORE_LIMIT);
  if (error) throw new Error(`Reading the open applications failed: ${error.message}`);
  const applications = (data ?? []) as Row[];
  if (applications.length === 0) return outcome;

  const context = await loadScoringContext(supabase, userId);
  for (const row of applications) {
    const role = one(row.roles as Row | Row[] | null);
    if (!role) continue;
    const company = one(role.companies as Row | Row[] | null);
    const result = await scoreApplication({
      application: {
        id: row.id as string,
        status: row.status as string,
        title: role.title as string,
        company: (company?.name as string | undefined) ?? null,
        seniority: role.seniority as string | null,
        location: role.location as string | null,
        workMode: role.work_mode as string | null,
        compMinCents: role.comp_min_cents as number | null,
        compMaxCents: role.comp_max_cents as number | null,
        requirements: Array.isArray(role.requirements) ? (role.requirements as Requirement[]) : null,
        requirementMatches: Array.isArray(role.requirement_matches)
          ? (role.requirement_matches as RequirementMatch[])
          : null,
        jdText: role.jd_text as string | null,
      },
      context,
      onSpend: options.onSpend,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
    if (!result.ok) {
      outcome.failed += 1;
      if (['no-key', 'refused', 'rate-limited', 'overloaded'].includes(result.reason)) {
        outcome.stopped = result.reason;
        break;
      }
      continue;
    }
    const { error: writeError } = await supabase
      .from('applications')
      .update({ scores: result.scores, scored_at: new Date().toISOString(), score_model: JEV_MODEL })
      .eq('id', row.id as string)
      .eq('user_id', userId);
    if (writeError) outcome.failed += 1;
    else outcome.scored += 1;
  }
  return outcome;
}
