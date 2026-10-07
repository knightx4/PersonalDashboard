import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { triageFrom, type Triage } from '@/lib/feedback/triage';
import { scoreIdea, type ScoreIdeaInput } from '@/lib/ideas/score-ask';
import { SCORE_DUE_FILTER, needsScore, visionForIdea, type IdeaScore } from '@/lib/ideas/score';
import { isModuleId, type ModuleId } from '@/lib/modules';
import { loadModuleVisions } from '@/lib/specs/vision';

/**
 * Scoring ideas and storing the score on the row (plan #1327, under feature
 * #1320). Two ways in:
 *
 * - `scoreIdeaRow`, once an idea filed from the header panel has been
 *   triaged (app/dev/bugs/actions.ts#triageFiled), so it has its score within
 *   a few seconds.
 * - `scoreUnscoredIdeas`, the catch-up: every live idea whose score is null
 *   or was asked under an older wording of the question (needsScore). That
 *   covers the ideas filed before scoring, the ones sessions and the night
 *   digest file without triage, any Jev failed on last time, and every live
 *   idea once after the question changes (plan #1644). The daily cron runs it
 *   (inngest/dev/idea-scores.ts).
 *
 * A failed call writes nothing, so the old score (or null) stays and the next
 * catch-up asks again. The score is only written over one that is due, so the
 * catch-up never replaces one the filing hook wrote a moment earlier.
 *
 * No `server-only` guard and no client of its own: the caller passes the
 * client, the person's or the service role's, and every query is matched on
 * `user_id` as well.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public', any>;

type Ask = (input: ScoreIdeaInput) => ReturnType<typeof scoreIdea>;
type Visions = Readonly<Partial<Record<string, { body: string }>>>;

/** Two ideas a second at most: the catch-up waits this long between asks. */
export const SCORE_GAP_MS = 500;
/**
 * The most one catch-up reads for one person. About two hundred live ideas
 * were unscored when scoring began; the cron's minute ends a run sooner.
 */
export const CATCH_UP_LIMIT = 250;

type IdeaForScore = { id: string; body: string; module: ModuleId | null; triage: Triage | null };

function toIdea(row: { id: unknown; body: unknown; module: unknown; triage: unknown }): IdeaForScore {
  const workspace = typeof row.module === 'string' && isModuleId(row.module) ? row.module : null;
  return { id: String(row.id), body: String(row.body ?? ''), module: workspace, triage: triageFrom(row.triage) };
}

async function askAndStore(
  supabase: Client,
  userId: string,
  idea: IdeaForScore,
  visions: Visions,
  spend: SpendReport[],
  ask: Ask,
): Promise<IdeaScore | null> {
  const result = await ask({
    body: idea.body,
    module: idea.module,
    vision: visionForIdea(visions, idea.module),
    triage: idea.triage,
    onSpend: (report) => spend.push(report),
  });
  if (!result.ok) {
    if (result.reason !== 'no-key') console.warn(`[idea-score] ${idea.id} ${result.reason}: ${result.detail}`);
    return null;
  }
  const { error } = await supabase
    .from('ideas')
    .update({ score: result.score })
    .eq('id', idea.id)
    .eq('user_id', userId)
    .or(SCORE_DUE_FILTER);
  if (error) {
    console.warn(`[idea-score] could not store ${idea.id}: ${error.message}`);
    return null;
  }
  return result.score;
}

/**
 * Score one idea just filed. `triage` is what triage has just stored, when
 * it has; otherwise the row's own is read. Null, and nothing written, when
 * the idea is not the caller's, is dismissed or already scored, or Jev failed.
 */
export async function scoreIdeaRow(
  supabase: Client,
  input: {
    userId: string;
    id: string;
    triage?: Triage | null;
    spend: SpendReport[];
    ask?: Ask;
  },
): Promise<IdeaScore | null> {
  const { data } = await supabase
    .from('ideas')
    .select('id, body, module, triage, score, dismissed_at')
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (!data || data.dismissed_at || !needsScore(data.score)) return null;
  const idea = toIdea(data);
  if (input.triage) idea.triage = input.triage;
  const visions = await loadModuleVisions(supabase, input.userId);
  return askAndStore(supabase, input.userId, idea, visions, input.spend, input.ask ?? scoreIdea);
}

export type CatchUpResult = {
  /** Ideas scored and stored this run. */
  scored: number;
  /** Ideas Jev failed on, or whose score could not be stored; still null. */
  failed: number;
  /** Ideas still due left for the next run, by the limit or the deadline. */
  left: number;
};

/**
 * The catch-up: score every live idea whose score is due (null, or asked
 * under an older wording), oldest first, at
 * most two a second. Stops starting new asks at `limit` or once `deadline`
 * (epoch ms) has passed; what is left waits for the next run.
 */
export async function scoreUnscoredIdeas(
  supabase: Client,
  input: {
    userId: string;
    spend: SpendReport[];
    limit?: number;
    deadline?: number;
    gapMs?: number;
    ask?: Ask;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<CatchUpResult> {
  const limit = input.limit ?? CATCH_UP_LIMIT;
  const gapMs = input.gapMs ?? SCORE_GAP_MS;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  const { data, error } = await supabase
    .from('ideas')
    .select('id, body, module, triage')
    .eq('user_id', input.userId)
    .or(SCORE_DUE_FILTER)
    .is('dismissed_at', null)
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (error) throw new Error(`reading unscored ideas: ${error.message}`);
  const rows = (data ?? []) as { id: unknown; body: unknown; module: unknown; triage: unknown }[];
  const ideas = rows.slice(0, limit).map(toIdea);
  const result: CatchUpResult = { scored: 0, failed: 0, left: rows.length - ideas.length };
  if (ideas.length === 0) return result;

  const visions = await loadModuleVisions(supabase, input.userId);
  let lastStart: number | null = null;
  for (let i = 0; i < ideas.length; i += 1) {
    if (input.deadline !== undefined && now() >= input.deadline) {
      result.left += ideas.length - i;
      break;
    }
    if (lastStart !== null) {
      const wait = lastStart + gapMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
    const score = await askAndStore(supabase, input.userId, ideas[i], visions, input.spend, input.ask ?? scoreIdea);
    if (score) result.scored += 1;
    else result.failed += 1;
  }
  return result;
}
