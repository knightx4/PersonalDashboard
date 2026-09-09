import { z } from 'zod';
import {
  isEmptyResolution,
  resolvedSourceSchema,
  sanitiseResolution,
  type ResolvedSource,
} from '@/lib/learn/import/resolve-payload';

/**
 * The shape a plan for a whole topic comes back in, and the rules it has to
 * satisfy.
 *
 * Split from the call itself so it can be tested without a network and without
 * a key -- the same split resolve-payload.ts makes, and for the same reason:
 * the validation is where the module's rules actually live.
 *
 * The rule that matters here is the one the module was built against. A
 * generated curriculum is quietly incomplete far more often than it is wrong:
 * a model asked for a reading list will fill every step it named, because a
 * step with nothing beside it looks like a failure. It is not. A step whose
 * source could not be found is the single most useful thing the plan can tell
 * you, and it survives to the screen as its own row rather than being dropped
 * to make the list look finished.
 */

/** More than this and it stops being a plan and starts being a pile. */
export const MAX_PLAN_STEPS = 8;

export const planStepSchema = z.object({
  /** What you would be learning, in the reader's terms, not a source title. */
  subject: z.string().trim().min(1).max(300),
  /** What this step gives that the one before it did not. One line. */
  why: z.string().trim().max(500).nullable().optional(),
  /** Where to read it, when the search found somewhere. */
  source: resolvedSourceSchema.nullable().optional(),
  /**
   * Why nothing was found, when nothing was. Said in the model's own words
   * because "paywalled everywhere I looked" and "I could not find anything
   * written about this at all" send you to different next moves.
   */
  no_source_reason: z.string().trim().max(500).nullable().optional(),
});

export const planPayloadSchema = z.object({
  steps: z.array(planStepSchema).max(20).default([]),
  /** Said out loud when the topic is too vague to plan at all. */
  too_vague: z.boolean().default(false),
});

export type PlanPayload = z.infer<typeof planPayloadSchema>;

/** One step of a plan, after the rules below have been applied. */
export type PlanStep = {
  subject: string;
  why: string | null;
  /** Null when the search found nowhere to read this. */
  source: ResolvedSource | null;
  /** Set exactly when `source` is null. */
  noSourceReason: string | null;
};

const NO_REASON_GIVEN = 'Nothing was found for this, and no reason was given.';

/**
 * The rules applied after the model has spoken.
 *
 * Ordering is the model's, and is load-bearing -- each step is supposed to
 * assume only what the ones before it taught -- so nothing here reorders. What
 * it does is drop what cannot be a step, dedupe subjects that say the same
 * thing twice, put every source through the resolver's own sanitising, and
 * make the source/gap split explicit so no caller has to work it out again.
 */
export function normalisePlan(payload: PlanPayload): PlanStep[] {
  const seen = new Set<string>();
  const steps: PlanStep[] = [];

  for (const raw of payload.steps) {
    const subject = raw.subject.trim();
    if (!subject) continue;

    // Two steps naming the same thing are one step. A generated plan repeats
    // itself when it is padding, and padding is what the cap is for.
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const sanitised = raw.source ? sanitiseResolution(raw.source) : null;
    // A source the model itself gave up on is a gap wearing a title. Treating
    // it as a source would hide exactly the thing this step exists to report.
    const source = sanitised && !isEmptyResolution(sanitised) ? sanitised : null;

    steps.push({
      subject,
      why: raw.why?.trim() || null,
      source,
      noSourceReason: source ? null : raw.no_source_reason?.trim() || NO_REASON_GIVEN,
    });

    if (steps.length >= MAX_PLAN_STEPS) break;
  }

  return steps;
}

/** The steps that have somewhere to read them. */
export function stepsWithSource(steps: PlanStep[]): PlanStep[] {
  return steps.filter((step) => step.source !== null);
}

/** The steps that do not — what the plan could not find sources for. */
export function stepsWithoutSource(steps: PlanStep[]): PlanStep[] {
  return steps.filter((step) => step.source === null);
}
