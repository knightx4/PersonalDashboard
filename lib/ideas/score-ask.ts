import type { SpendSink } from '@/lib/core/spend/pricing';
import type { Triage } from '@/lib/feedback/triage';
import { askJev, type JevFailure } from '@/lib/jev/wire';
import type { ModuleId } from '@/lib/modules';
import { IDEA_SCORE_QUESTION, ideaScoreState, readIdeaScore, type IdeaScore } from '@/lib/ideas/score';

/**
 * Ask Jev how much one idea helps what its workspace is for (plan #1324).
 *
 * Imports lib/jev/wire.ts directly, without the `server-only` guard of
 * lib/jev/client.ts, so scripts/idea-scores.ts can try it on real ideas under
 * plain `tsx`. Nothing in a browser bundle imports this file.
 *
 * Never throws. A failed call comes back as the failure and nothing is
 * stored: the idea's score stays null and the catch-up asks again. Spend is
 * reported to `onSpend` for every response that carried usage, as for the
 * other Jev callers.
 */
export type ScoreIdeaInput = {
  body: string;
  /** The workspace, or null for the app as a whole. */
  module: ModuleId | null;
  /** From `visionForIdea`: the workspace's vision, the app's for an app-wide idea, or null. */
  vision: string | null;
  triage: Triage | null;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export async function scoreIdea(
  input: ScoreIdeaInput,
): Promise<{ ok: true; score: IdeaScore } | JevFailure> {
  const result = await askJev({
    state: ideaScoreState(input),
    question: IDEA_SCORE_QUESTION,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
  if (!result.ok) return result;
  const score = readIdeaScore(result);
  return score ? { ok: true, score } : { ok: false, reason: 'malformed', detail: 'no score in the answer' };
}
