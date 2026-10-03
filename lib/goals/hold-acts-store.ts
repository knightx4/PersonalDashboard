import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordDashAction, type DashActionSurface } from '@/lib/core/dash-actions';
import { scheduledBefore, scheduledDashDeps } from '@/lib/core/scheduled-actions';
import { recordSpendReports } from '@/lib/core/spend/record';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  ACTS_QUESTION,
  actsState,
  checkActs,
  fallbackActsSentence,
  type ActsCandidate,
} from '@/lib/goals/hold-acts';
import { writeActsSentence } from '@/lib/goals/hold-acts-model';
import { decideWithJev } from '@/lib/jev/decide';
import { jevEnabledFor } from '@/lib/jev/enabled';

/**
 * The check behind plan #1183, run before a goals run starts: the morning
 * run, Work on this on a goal, and Send on a step (which the night tick and
 * an @dash reply also go through). The rules are in lib/goals/hold-acts.ts.
 *
 * Every open Claude step with no `acts` sentence is put to Jev. A step Jev
 * gives a yes of 0.3 or more is held: Haiku writes its sentence and
 * `goals.hold_acting_step` (migrations-goals/0058) sets it back to proposed
 * with that sentence, as the app, so it waits on Approve like any step Dash
 * proposed. A step blocked on the person is left alone; it is checked again
 * once it reopens.
 *
 * Nothing is asked when the account has not agreed to send its text to
 * TypeSafe (jevEnabledFor). Jev failing leaves every step as it is. Never
 * throws: a run is still worth starting when the check could not be made.
 */

/**
 * `report` asks Jev and says what it would hold, and writes nothing: the
 * trial the feature ran before switching it on (docs/trials/). `hold` holds.
 */
export type HoldActsMode = 'report' | 'hold';

/** Switched on after the report-only trial of 2026-09-29. */
export const HOLD_ACTS_MODE: HoldActsMode = 'hold';

export type HeldStep = {
  id: string;
  title: string;
  probability: number;
  /** The sentence it was held with; absent in report mode. */
  acts?: string;
};

export type HoldActsResult =
  | { skipped: string }
  | {
      mode: HoldActsMode;
      /** Steps put to Jev. */
      checked: number;
      /** Steps Jev did not answer for, left as they are. */
      unanswered: number;
      /** Held, or in report mode, would be held. */
      held: HeldStep[];
    };

/**
 * Where the run that held the step was started, for the record of each hold
 * (feature #1456): `scheduled` for the morning run and the night tick,
 * `thread` for a run the person started themselves, from a button on the
 * goals page, a new errand or an @dash reply.
 */
export type HoldSurface = Extract<DashActionSurface, 'thread' | 'scheduled'>;

export type HoldActsInput = {
  client: GoalsSupabaseClient;
  userId: string;
  mode?: HoldActsMode;
  /** Only the check on these steps, when a caller knows which it is about to work. */
  stepIds?: readonly string[];
  /** Stand-ins for tests. */
  ask?: (step: ActsCandidate) => Promise<number | null>;
  write?: (step: ActsCandidate) => Promise<string | null>;
  enabled?: boolean;
  /**
   * Each step held is recorded as Dash's change under this surface, with Undo
   * on Home: the morning run since plan #1570, the pressed paths since #1573.
   * Left out, nothing is recorded.
   */
  surface?: HoldSurface;
};

/** Open Claude steps with no sentence, and those blocked only on other steps. */
export async function loadActsCandidates(
  client: GoalsSupabaseClient,
  userId: string,
  stepIds?: readonly string[],
): Promise<ActsCandidate[]> {
  let query = client
    .from('items')
    .select('id, title, detail, acceptance, status, block_kind')
    .eq('user_id', userId)
    .eq('level', 'step')
    .eq('kind', 'claude')
    .in('status', ['open', 'blocked'])
    .is('acts', null)
    .is('archived_at', null);
  if (stepIds) query = query.in('id', [...stepIds]);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the Claude steps: ${error.message}`);
  return (data ?? [])
    .filter((row) => row.status === 'open' || row.block_kind === 'steps')
    .map((row) => ({
      id: row.id as string,
      title: row.title as string,
      detail: (row.detail as string | null) ?? null,
      acceptance: (row.acceptance as string | null) ?? null,
    }));
}

export async function holdActingSteps(input: HoldActsInput): Promise<HoldActsResult> {
  const { client, userId } = input;
  const mode = input.mode ?? HOLD_ACTS_MODE;
  try {
    const core = client.schema('core') as unknown as CoreSupabaseClient;
    const enabled = input.enabled ?? (await jevEnabledFor(core, userId));
    if (!enabled) return { skipped: 'this account has not agreed to send its text to Jev' };

    const steps = await loadActsCandidates(client, userId, input.stepIds);
    if (steps.length === 0) return { mode, checked: 0, unanswered: 0, held: [] };

    const jevSpend: SpendReport[] = [];
    const ask =
      input.ask ??
      (async (step: ActsCandidate) => {
        const decided = await decideWithJev({
          state: actsState(step),
          question: ACTS_QUESTION,
          // Jev's answer always stands; the threshold is on its probability.
          floor: 0,
          read: (answer) => answer.probability,
          fallback: async () => null,
          onSpend: (report) => jevSpend.push(report),
        });
        return decided.value;
      });
    const checks = await checkActs(steps, ask);

    const haikuSpend: SpendReport[] = [];
    const write =
      input.write ??
      ((step: ActsCandidate) => writeActsSentence(step, { onSpend: (report) => haikuSpend.push(report) }));

    const held: HeldStep[] = [];
    for (const check of checks) {
      if (!check.held || check.probability === null) continue;
      const found = { id: check.step.id, title: check.step.title, probability: check.probability };
      if (mode === 'report') {
        held.push(found);
        continue;
      }
      const acts = (await write(check.step)) ?? fallbackActsSentence(check.step);
      const ref = `goals.items:${check.step.id}`;
      const before = input.surface ? await scheduledBefore(client, userId, ref) : null;
      const { data, error } = await client.rpc('hold_acting_step', { step: check.step.id, sentence: acts });
      if (error) {
        console.warn(`[goals] step ${check.step.id} not held: ${error.message}`);
        continue;
      }
      if (data === true) {
        held.push({ ...found, acts });
        if (input.surface) {
          // Over whichever client the caller holds: the service client on a
          // timer, the person's own on a press, where row level security
          // keeps the record and the read to their rows.
          await recordDashAction(scheduledDashDeps(client, userId), {
            surface: input.surface,
            kind: 'hold_acting_step',
            subjectRef: ref,
            op: 'update',
            summary: `Dash turned the step "${check.step.title}" into a proposal for you to approve, because it acts outside the plan: ${acts}`,
            beforeValues: before,
          });
        }
      }
    }

    await Promise.all([
      recordSpendReports(core, userId, { module: 'goals', operation: 'check-step-acts' }, jevSpend),
      recordSpendReports(core, userId, { module: 'goals', operation: 'write-acts-sentence' }, haikuSpend),
    ]).catch((error: unknown) => {
      console.warn(`[goals] acts check spend not recorded: ${error instanceof Error ? error.message : 'failed'}`);
    });

    return {
      mode,
      checked: checks.length,
      unanswered: checks.filter((check) => check.probability === null).length,
      held,
    };
  } catch (error) {
    console.warn(`[goals] acts check not made: ${error instanceof Error ? error.message : 'failed'}`);
    return { skipped: 'the check could not be made' };
  }
}
