import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { recordLearnSpend } from '@/lib/learn/spend';
import { readSubQuestions } from './model';
import { SUB_QUESTIONS_MIN } from './research';
import { researchBriefAfterResponse } from './research-run';

/**
 * Try again on a research brief whose run failed (plan #2023.4): set it back
 * to researching, at the search when its sub-questions are already framed and
 * at the framing when not, and start the run once the response has gone. A
 * brief that is not failed any more is left alone and starts nothing.
 *
 * The brief page's button and Dash's retry_research_brief
 * (lib/dash/paid-tools-learn.ts) both call this.
 */
export async function retryBriefFor(
  supabase: LearnSupabaseClient,
  userId: string,
  briefId: string,
): Promise<{ ok: true; restarted: boolean } | { ok: false; error: string }> {
  const { data: current, error: readError } = await supabase
    .from('briefs')
    .select('sub_questions')
    .eq('id', briefId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) return { ok: false, error: `Could not start it again: ${readError.message}` };
  if (!current) return { ok: false, error: 'That brief could not be found.' };
  const framed = readSubQuestions((current as { sub_questions: unknown }).sub_questions).length >= SUB_QUESTIONS_MIN;
  const { data: reset, error } = await supabase
    .from('briefs')
    .update({
      status: 'researching',
      stage: framed ? 'searching' : 'framing',
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', briefId)
    .eq('user_id', userId)
    .eq('status', 'failed')
    .select('id');
  if (error) return { ok: false, error: `Could not start it again: ${error.message}` };
  const restarted = (reset ?? []).length > 0;
  if (restarted) {
    // The recorder is spelled out, rather than left to the runner's default,
    // so the paid-actions walk can see what this press records.
    researchBriefAfterResponse(supabase, userId, briefId, {
      recordSpend: (owner, reports) => recordLearnSpend(owner, 'research-topic', reports),
    });
  }
  return { ok: true, restarted };
}
