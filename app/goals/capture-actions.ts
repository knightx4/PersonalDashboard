'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, type PaidCosts } from '@/lib/core/spend/paid-actions';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { serverEnv } from '@/lib/env';
import { createGoalsClient } from '@/lib/goals/auth/server';
import {
  CAPTURE_BODY_MAX,
  fileCapture,
  type CaptureContext,
  type FiledEntry,
} from '@/lib/goals/capture';
import { askCaptureModel } from '@/lib/goals/capture-model';
import {
  CAPTURE_SORT_MIN_CHARS,
  CAPTURE_SORT_QUESTION,
  CAPTURE_SORT_TIMEOUT_MS,
  captureHintLine,
  captureSortState,
  isCaptureMove,
  type CaptureGuess,
  type CaptureMove,
} from '@/lib/goals/capture-sort';
import { askJev } from '@/lib/jev/client';
import { JEV_CONFIDENCE_FLOOR } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { PROGRESS_ESTIMATES, type ProgressEstimate } from '@/lib/goals/progress';
import {
  answerFiledEstimate,
  applyCaptureAction,
  keepCapture,
  loadCaptureContext,
  saveFiled,
  undoFiled,
} from '@/lib/goals/capture-store';
import { todayIn } from '@/lib/todo/tasks/model';

/**
 * The capture box's two writes for Goals (plan #929): file a sentence, and
 * undo one line of what it filed. Called from the shell's capture panel
 * (components/shell/capture.tsx), so it is reachable from every page.
 *
 * Both write through a client made as the capture actor with the capture's
 * id, so goals.history records each change as capture's and names the
 * sentence it came from.
 */

export type GoalCaptureState = {
  error?: string;
  captureId?: string;
  filed?: FiledEntry[];
};

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

function refresh() {
  revalidatePath('/goals', 'layout');
  revalidatePath('/todo', 'layout');
  revalidatePath('/home');
}

/**
 * The move the capture box settled on before filing: Jev's confident guess,
 * or the chip the person picked when Jev was unsure. Null leaves Haiku to
 * decide everything, as before plan #1177.
 */
export type CaptureMoveHint = { move: CaptureMove; picked: boolean } | null;

// latency: pending
export async function fileGoalCapture(
  body: string,
  hint: CaptureMoveHint = null,
): Promise<GoalCaptureState> {
  const user = await requireUser();
  if (typeof body !== 'string') return { error: 'Write what happened first.' };
  const hintLine =
    hint && isCaptureMove(hint.move) ? captureHintLine(hint.move, hint.picked === true) : null;

  const key = apiKey();
  if (!key) return { error: 'No ANTHROPIC_API_KEY on the deployment, so nothing can be filed.' };

  const account = await loadAccountSettings(user.id);
  const today = todayIn(account.timezone);
  const captureId = randomUUID();
  const client = await createGoalsClient({ actor: 'capture', captureId });
  // Reading the tree opens and closes rhythm periods as every page read does;
  // that housekeeping is not the capture's doing, so it goes as a plain read.
  const reader = await createGoalsClient();
  const spend: SpendReport[] = [];

  try {
    const result = await fileCapture(body, today, {
      keep: (text) => keepCapture(client, user.id, captureId, text),
      context: () => loadCaptureContext(reader, { userId: user.id, today }),
      ask: (message) =>
        askCaptureModel({ apiKey: key, onSpend: (report) => spend.push(report) }, message),
      apply: (id, action) =>
        applyCaptureAction(client, { userId: user.id, today, captureId: id }, action),
      save: (id, filed) => saveFiled(client, id, filed),
    }, hintLine);
    await recordSessionSpend(user.id, { module: 'goals', operation: 'file-capture' }, spend);
    if (!result.ok) return { error: result.error, captureId: result.captureId ?? undefined };
    if (result.filed.length > 0) refresh();
    return { captureId: result.captureId, filed: result.filed };
  } catch {
    await recordSessionSpend(user.id, { module: 'goals', operation: 'file-capture' }, spend);
    return { error: 'That could not be filed. Try again.' };
  }
}

/**
 * Each account's goals outline, for the guess while typing. A pause in typing
 * asks again, and reading the whole tree for every pause would cost more than
 * the guess; a step closed a minute ago still being in the outline changes
 * nothing Jev is asked. Per server instance, like the waiting sort's cache.
 */
const SORT_CONTEXT = new Map<string, { at: number; context: CaptureContext }>();
const SORT_CONTEXT_TTL_MS = 60_000;

async function sortContext(userId: string): Promise<CaptureContext | null> {
  const held = SORT_CONTEXT.get(userId);
  if (held && Date.now() - held.at < SORT_CONTEXT_TTL_MS) return held.context;
  try {
    const account = await loadAccountSettings(userId);
    const reader = await createGoalsClient();
    const context = await loadCaptureContext(reader, {
      userId,
      today: todayIn(account.timezone),
    });
    SORT_CONTEXT.set(userId, { at: Date.now(), context });
    return context;
  } catch {
    return null;
  }
}

/**
 * Which of the five moves a sentence mainly is, asked of Jev while it is
 * being typed (plan #1177). The box calls this when typing pauses. Null when
 * there is no guess to show: the account has not agreed to send text to
 * TypeSafe, the sentence is too short, or Jev failed or took too long. A
 * guess under 0.8 comes back with `sure: false`, and the box asks the person
 * to pick instead of showing it as what will happen.
 *
 * No Haiku call here: the fallback below the floor is the person's pick, and
 * Haiku still files the sentence when they press enter.
 */
// latency: pending
export async function sortGoalCapture(body: string): Promise<CaptureGuess | null> {
  const user = await requireUser();
  if (typeof body !== 'string') return null;
  const sentence = body.trim();
  if (sentence.length < CAPTURE_SORT_MIN_CHARS || body.length > CAPTURE_BODY_MAX) return null;

  const core = await createCoreClient();
  if (!(await jevEnabledFor(core, user.id))) return null;

  const context = await sortContext(user.id);
  const spend: SpendReport[] = [];
  const result = await askJev({
    state: captureSortState(sentence, context),
    question: CAPTURE_SORT_QUESTION,
    onSpend: (report) => spend.push(report),
    timeoutMs: CAPTURE_SORT_TIMEOUT_MS,
  });
  await recordSessionSpend(user.id, { module: 'goals', operation: 'sort-capture' }, spend);
  if (!result.ok) return null;
  const { choice, confidence } = result.answer;
  if (!isCaptureMove(choice)) return null;
  return { move: choice, confidence, sure: confidence >= JEV_CONFIDENCE_FLOOR };
}

const Undo = z.object({ captureId: z.string().uuid(), index: z.number().int().min(0).max(50) });

// latency: pending
export async function undoGoalCapture(captureId: string, index: number): Promise<GoalCaptureState> {
  await requireUser();
  const parsed = Undo.safeParse({ captureId, index });
  if (!parsed.success) return { error: 'Could not tell which line that was.' };
  try {
    const client = await createGoalsClient({ actor: 'capture', captureId: parsed.data.captureId });
    const result = await undoFiled(client, parsed.data.captureId, parsed.data.index);
    if (!result.ok) return { error: result.error };
    refresh();
    return { captureId: parsed.data.captureId, filed: result.filed };
  } catch {
    return { error: 'That could not be undone. Try again.' };
  }
}

const Estimate = Undo.extend({ estimate: z.enum(PROGRESS_ESTIMATES) });

/**
 * Keep the tapped answer to "Roughly how far along?" on the progress a line
 * filed (plan #1280), and on the line so it is not asked again.
 */
// latency: pending
export async function estimateGoalCapture(
  captureId: string,
  index: number,
  estimate: ProgressEstimate,
): Promise<GoalCaptureState> {
  await requireUser();
  const parsed = Estimate.safeParse({ captureId, index, estimate });
  if (!parsed.success) return { error: 'Could not tell which line that was.' };
  try {
    const client = await createGoalsClient({ actor: 'capture', captureId: parsed.data.captureId });
    const result = await answerFiledEstimate(
      client,
      parsed.data.captureId,
      parsed.data.index,
      parsed.data.estimate,
    );
    if (!result.ok) return { error: result.error };
    refresh();
    return { captureId: parsed.data.captureId, filed: result.filed };
  } catch {
    return { error: 'That could not be kept. Try again.' };
  }
}

/**
 * The $ figure for the capture panel's File it button. The panel sits in the
 * shell rather than under one module's layout, so it asks for its one figure
 * when the Goals action is opened instead of reading it from a layout.
 */
// latency: pending
export async function goalCaptureCosts(): Promise<PaidCosts> {
  const user = await requireUser();
  try {
    const core = await createCoreClient();
    return await estimatePaidActions(core, user.id, ['app/goals/capture-actions.ts#fileGoalCapture']);
  } catch {
    return {};
  }
}
