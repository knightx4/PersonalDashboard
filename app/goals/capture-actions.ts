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
import { fileCapture, type FiledEntry } from '@/lib/goals/capture';
import { askCaptureModel } from '@/lib/goals/capture-model';
import {
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

// latency: pending
export async function fileGoalCapture(body: string): Promise<GoalCaptureState> {
  const user = await requireUser();
  if (typeof body !== 'string') return { error: 'Write what happened first.' };

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
      apply: (_id, action) => applyCaptureAction(client, user.id, action),
      save: (id, filed) => saveFiled(client, id, filed),
    });
    await recordSessionSpend(user.id, { module: 'goals', operation: 'file-capture' }, spend);
    if (!result.ok) return { error: result.error, captureId: result.captureId ?? undefined };
    if (result.filed.length > 0) refresh();
    return { captureId: result.captureId, filed: result.filed };
  } catch {
    await recordSessionSpend(user.id, { module: 'goals', operation: 'file-capture' }, spend);
    return { error: 'That could not be filed. Try again.' };
  }
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
