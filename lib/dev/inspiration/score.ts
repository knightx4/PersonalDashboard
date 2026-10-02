import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { CATCH_UP_LIMIT, SCORE_GAP_MS, type CatchUpResult } from '@/lib/ideas/score-run';
import { scoreIdea, type ScoreIdeaInput } from '@/lib/ideas/score-ask';
import { visionForIdea } from '@/lib/ideas/score';
import { isModuleId } from '@/lib/modules';
import { loadModuleVisions } from '@/lib/specs/vision';

/**
 * Jev's score on the inspiration takeaways (note 790c745a), so the tab can
 * rank them best first the way the Ideas tab ranks ideas.
 *
 * The ideas' own question and scale (lib/ideas/score.ts): how much the
 * takeaway would help what its workspace is for, effort left out, 0 to 100.
 * A takeaway was not triaged, so Jev is told so. Runs beside the idea
 * catch-up in the daily cron (inngest/dev/idea-scores.ts); a failed ask
 * writes nothing and the next run asks again.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public', any>;
type Ask = (input: ScoreIdeaInput) => ReturnType<typeof scoreIdea>;

/** The text Jev reads for one takeaway: its title as the first line, then the body. */
export function takeawayScoreText(takeaway: { title: string; body: string }): string {
  return `${takeaway.title.trim()}\n\n${takeaway.body.trim()}`;
}

/**
 * Score every takeaway of one person's that is not dismissed and has no
 * score, oldest first, at most two a second, until `limit` or `deadline`.
 */
export async function scoreUnscoredTakeaways(
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
  const ask = input.ask ?? scoreIdea;

  const { data, error } = await supabase
    .from('inspiration_takeaways')
    .select('id, title, body, module')
    .eq('user_id', input.userId)
    .is('score', null)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  if (error) throw new Error(`reading unscored takeaways: ${error.message}`);
  const rows = (data ?? []) as { id: string; title: string; body: string; module: string | null }[];
  const takeaways = rows.slice(0, limit);
  const result: CatchUpResult = { scored: 0, failed: 0, left: rows.length - takeaways.length };
  if (takeaways.length === 0) return result;

  const visions = await loadModuleVisions(supabase, input.userId);
  let lastStart: number | null = null;
  for (let i = 0; i < takeaways.length; i += 1) {
    if (input.deadline !== undefined && now() >= input.deadline) {
      result.left += takeaways.length - i;
      break;
    }
    if (lastStart !== null) {
      const wait = lastStart + gapMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();
    const takeaway = takeaways[i];
    const workspace = takeaway.module && isModuleId(takeaway.module) ? takeaway.module : null;
    const answer = await ask({
      body: takeawayScoreText(takeaway),
      module: workspace,
      vision: visionForIdea(visions, workspace),
      triage: null,
      onSpend: (report) => input.spend.push(report),
    });
    if (!answer.ok) {
      if (answer.reason !== 'no-key') console.warn(`[takeaway-score] ${takeaway.id} ${answer.reason}: ${answer.detail}`);
      result.failed += 1;
      continue;
    }
    const stored = await supabase
      .from('inspiration_takeaways')
      .update({ score: answer.score })
      .eq('id', takeaway.id)
      .eq('user_id', input.userId)
      .is('score', null);
    if (stored.error) {
      console.warn(`[takeaway-score] could not store ${takeaway.id}: ${stored.error.message}`);
      result.failed += 1;
    } else {
      result.scored += 1;
    }
  }
  return result;
}
