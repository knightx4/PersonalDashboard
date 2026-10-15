import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import { guideCall } from './guide-model';
import {
  DIG_SYSTEM,
  digPrompt,
  PLAIN_DIG,
  READBACK_SYSTEM,
  readbackPrompt,
  readReadback,
  usableQuestion,
} from './guide';
import type { EssayBrief } from './model';
import { nextDigKind, withAsking, withReadback, type DigKind, type EssayPlan } from './plan';

/**
 * The guided essay's calls that change the plan, shared by the actions that
 * make them (LEARN-ESSAYS-SPEC, "The stages"). Each takes the plan as it is
 * and returns the next one, or why it could not.
 */

/**
 * Dash's read of the brief: up to three notes, each ending in a question, and
 * sharper versions of the question. Replies the person gave to the last read
 * go with it, so a second read moves on from what they settled.
 */
export async function readbackPlan(input: {
  brief: EssayBrief;
  plan: EssayPlan;
  anthropicApiKey: string;
  onSpend?: SpendSink;
}): Promise<{ ok: true; plan: EssayPlan } | { ok: false; detail: string }> {
  const reply = await guideCall({
    system: READBACK_SYSTEM,
    prompt: readbackPrompt(input.brief, input.plan.readback?.notes ?? []),
    maxTokens: 800,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  });
  if (!reply.ok) return reply;
  const read = readReadback(reply.text);
  if (read.notes.length === 0 && read.sharper.length === 0) {
    return { ok: false, detail: 'The read came back with nothing the page shows.' };
  }
  return {
    ok: true,
    plan: withReadback(input.plan, read.notes, read.sharper, new Date().toISOString()),
  };
}

/**
 * The next question about one point, of the kind given or the next in its
 * role's order. Without Dash's wording the plain question of that kind is
 * asked, so the conversation never stalls.
 */
export async function askPlan(input: {
  brief: EssayBrief;
  plan: EssayPlan;
  pointId: string;
  kind: DigKind | null;
  anthropicApiKey: string | undefined;
  onSpend?: SpendSink;
}): Promise<EssayPlan> {
  const point = input.plan.points.find((p) => p.id === input.pointId);
  if (!point || !point.text.trim()) return input.plan;
  const kind = nextDigKind(point, input.kind);
  let ask = PLAIN_DIG[kind];
  if (input.anthropicApiKey) {
    const reply = await guideCall({
      system: DIG_SYSTEM,
      prompt: digPrompt({ brief: input.brief, plan: input.plan, point, kind }),
      maxTokens: 200,
      anthropicApiKey: input.anthropicApiKey,
      onSpend: input.onSpend,
    });
    const worded = reply.ok ? usableQuestion(reply.text) : null;
    if (worded) ask = worded;
    else if (!reply.ok) console.error('[essay dig]', reply.detail);
  }
  return withAsking(input.plan, point.id, kind, ask);
}
