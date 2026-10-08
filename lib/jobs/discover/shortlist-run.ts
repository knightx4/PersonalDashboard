/**
 * Dash's weekly startup shortlist (plan #1682, feature #1679): one model
 * call reads the filtered hiring lists against the person's CV, target titles
 * and newest career goals, keeps the 30 to 50 most worth a look with a
 * one-line reason each, and the picks are written to the watchlist.
 *
 * The person is described exactly as the roles search describes them
 * (seekerText, loadSeeker). There is no web search: Dash judges from the
 * lines it is given, so the call is one request, with a second only when
 * the first ends without the report.
 *
 * Running it again in the same week refreshes the same rows rather than
 * adding new ones (watchlistRows). The weekly schedule is plan #1684's.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendReport, type SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { searchStep, seekerText, type SearchRequest, type SeekerContext } from '@/lib/jobs/suggest/model';
import { loadSeeker } from '@/lib/jobs/suggest/run';
import type { DiscoveryRules, FilteredHiringLists } from './filter';
import { readHiringLists } from './read';
import {
  SHORTLIST_MAX,
  SHORTLIST_MIN,
  buildCandidates,
  interestTerms,
  parseShortlist,
  precut,
  watchlistRows,
  type ShortlistCandidate,
  type ShortlistPick,
  type WatchlistExisting,
} from './shortlist';

export const SHORTLIST_MODEL = MODELS.jobsDiscoverShortlist;
export const SHORTLIST_TOOL = 'shortlist_startups';
/** Thinking is on by default and counts against this; fifty short picks need about 5,000. */
const MAX_TOKENS = 32_000;
const DEFAULT_CALL_MS = 240_000;
const RESERVE_MS = 15_000;
const MIN_CALL_MS = 45_000;

const SYSTEM = `You pick startups worth a look for someone in a job search. You are given
what they want and their CV, then a list of startups that are hiring, one per
line, from two places: YC's directory of companies marked as hiring (lines
starting Y) and this month's Hacker News "Who is hiring?" thread (lines
starting H, and YC lines that also carry an "HN post"). The list has already
been filtered by their preferences, so do not filter it again by location or
stage; judge fit.

Pick the ${SHORTLIST_MIN} to ${SHORTLIST_MAX} most worth their time: companies where the work they
want next plausibly exists now or will soon, in a field their CV or goals
point to. Weigh the newest career goals entry most. A Hacker News post that
names a role close to what they want beats a company that might have one.
Leave out any company in an industry they will not work in, whatever the role.

For each pick give:
- id: the line's id, exactly as shown (Y12, H5).
- reason: one line to them, as "you", saying why this company: what it does
  that fits what they want, or the role it is hiring for. Under 25 words, no
  em dashes, no hype.
- score: a whole number from 1 to 100 for how well the company fits what
  they want next. 90 and above: the role they want is open or plainly will
  be, in their field. 70 to 89: a strong fit worth applying to. 50 to 69: a
  reasonable fit with something missing. Below 50: a long shot. Score each
  pick on its own; do not spread the scores to fill the range.
- For a line with a Hacker News post, also: company (the company's name as
  the post gives it, without "(YC S24)" and the like), roles (the roles the
  post names, as written), location (where the post says, as written, or
  null) and link (the careers or apply link the post gives, copied exactly
  from its links, or null). A Hacker News line that is not a company hiring
  (a question, a comment, someone looking for work) is never a pick.

Call ${SHORTLIST_TOOL} once with every pick.`;

const TOOL: Anthropic.Tool = {
  name: SHORTLIST_TOOL,
  description: 'Report the shortlisted startups, all in one call.',
  input_schema: {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            reason: { type: 'string' },
            score: { type: 'integer', minimum: 1, maximum: 100 },
            company: { type: ['string', 'null'] },
            roles: { type: 'array', items: { type: 'string' } },
            location: { type: ['string', 'null'] },
            link: { type: ['string', 'null'] },
          },
          required: ['id', 'reason', 'score'],
        },
      },
    },
    required: ['picks'],
  },
};

export function shortlistPrompt(seeker: SeekerContext, lines: readonly string[]): string {
  return (
    seekerText(seeker) +
    `\n\nThe startups (id | name | what it does | industry | stage, batch, team | places, or id | Hacker News post :: text :: links):\n` +
    lines.join('\n') +
    `\n\nCall ${SHORTLIST_TOOL} now with your ${SHORTLIST_MIN} to ${SHORTLIST_MAX} picks.`
  );
}

export type ShortlistOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** Epoch milliseconds by which the call must be done. */
  deadline?: number;
  /** Told of each call's cost as it is made; the outcome's `spend` holds the same. */
  onSpend?: SpendSink;
  /** The filtered lists, when the caller has already read them. */
  lists?: FilteredHiringLists & { rules: DiscoveryRules };
  now?: Date;
};

export type ShortlistOutcome = {
  ok: boolean;
  /** Startups shown to Dash, and how many were cut to fit the prompt. */
  offered: number;
  cut: number;
  /** Rows written: new to the watchlist, and already on it and refreshed. */
  added: number;
  refreshed: number;
  spend: SpendReport[];
  error: string | null;
};

function failure(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'Dash is rate-limited right now.';
  if (error instanceof Anthropic.APIError) return `The shortlist could not be made (${error.status}).`;
  return error instanceof Error ? error.message : 'The shortlist could not be made.';
}

/** The model call: picks read against the candidates shown, or why there are none. */
export async function askForShortlist(
  options: Pick<ShortlistOptions, 'apiKey' | 'client' | 'deadline' | 'onSpend'>,
  seeker: SeekerContext,
  shown: { kept: readonly ShortlistCandidate[]; lines: readonly string[] },
  exclude: ReadonlySet<string>,
  spend: SpendReport[],
): Promise<{ picks: ShortlistPick[]; error: string | null }> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let request: SearchRequest = {
    model: SHORTLIST_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    tools: [TOOL],
    messages: [{ role: 'user', content: shortlistPrompt(seeker, shown.lines) }],
  };
  const parse = (raw: unknown) => parseShortlist(raw, shown.kept, exclude);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const budget = options.deadline ? options.deadline - Date.now() - RESERVE_MS : DEFAULT_CALL_MS;
    if (budget < MIN_CALL_MS) return { picks: [], error: 'There was not enough time left to ask Dash.' };
    let response: Anthropic.Message;
    const signal = AbortSignal.timeout(budget);
    try {
      response = await client.messages.stream(request, { signal, timeout: budget, maxRetries: 0 }).finalMessage();
    } catch (error) {
      if (signal.aborted || error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
        return { picks: [], error: 'Dash took too long over the shortlist.' };
      }
      return { picks: [], error: failure(error) };
    }
    const report: SpendReport = { model: SHORTLIST_MODEL, usage: usageFrom(response.usage) };
    spend.push(report);
    options.onSpend?.(report);
    const step = searchStep(request, response, SHORTLIST_TOOL, parse);
    if (step.kind === 'report') {
      return step.suggestions.length > 0
        ? { picks: step.suggestions, error: null }
        : { picks: [], error: 'Dash reported no startups worth a look.' };
    }
    if (step.kind === 'refused') break;
    request = step.next;
  }
  return { picks: [], error: 'Dash did not report a shortlist.' };
}

const EXISTING_COLUMNS =
  'name, name_key, website, source, source_ref, description, stage, locations, posting_roles, posting_location, posting_url';

/** The picks written to the watchlist; a startup already on it is refreshed in place. */
export async function storeShortlist(
  supabase: AppSupabaseClient,
  userId: string,
  picks: readonly ShortlistPick[],
  now: Date,
): Promise<{ added: number; refreshed: number }> {
  if (picks.length === 0) return { added: 0, refreshed: 0 };
  const existing = await supabase
    .from('watchlist_startups')
    .select(EXISTING_COLUMNS)
    .eq('user_id', userId)
    .limit(10_000);
  if (existing.error) throw new Error(`Reading the watchlist failed: ${existing.error.message}`);
  const old = (existing.data ?? []) as unknown as WatchlistExisting[];
  const rows = watchlistRows(userId, picks, old, now);
  const { error } = await supabase.from('watchlist_startups').upsert(rows, { onConflict: 'user_id,name_key' });
  if (error) throw new Error(`Writing the shortlist failed: ${error.message}`);
  const had = new Set(old.map((row) => row.name_key));
  const refreshed = rows.filter((row) => had.has(row.name_key)).length;
  return { added: rows.length - refreshed, refreshed };
}

/**
 * One person's shortlist: read the lists (unless given), ask Dash, write the
 * picks. Every read and write names the person, so the cron's service client
 * and the person's own behave the same. A feed that fails throws, from
 * readHiringLists; a call that fails comes back as `error` with nothing
 * written.
 */
export async function shortlistStartups(
  supabase: AppSupabaseClient,
  userId: string,
  options: ShortlistOptions,
): Promise<ShortlistOutcome> {
  const spend: SpendReport[] = [];
  const outcome = (rest: Partial<ShortlistOutcome>): ShortlistOutcome => ({
    ok: false, offered: 0, cut: 0, added: 0, refreshed: 0, spend, error: null, ...rest,
  });
  const [seeker, lists] = await Promise.all([
    loadSeeker(supabase, userId),
    options.lists ? Promise.resolve(options.lists) : readHiringLists(supabase, userId),
  ]);
  if (seeker.goals.length === 0 && seeker.targetTitles.length === 0) {
    return outcome({ error: 'There are no career goals or target titles to shortlist against.' });
  }
  const candidates = buildCandidates(lists);
  if (candidates.length === 0) return outcome({ error: 'Neither hiring list had a startup left after the filter.' });

  const terms = interestTerms({ targetTitles: seeker.targetTitles, latestGoal: seeker.goals[0]?.body ?? null });
  const shown = precut(candidates, terms);
  const exclude = new Set([...lists.rules.knownCompanies, ...lists.rules.passedCompanies]);
  const { picks, error } = await askForShortlist(options, seeker, shown, exclude, spend);
  if (error) return outcome({ offered: shown.kept.length, cut: shown.cut, error });
  if (picks.length < SHORTLIST_MIN) {
    console.warn(`[jobs discovery] the shortlist kept ${picks.length}, fewer than ${SHORTLIST_MIN}`);
  }
  const stored = await storeShortlist(supabase, userId, picks, options.now ?? new Date());
  return outcome({ ok: true, offered: shown.kept.length, cut: shown.cut, ...stored });
}
