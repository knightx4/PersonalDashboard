import { createHash } from 'node:crypto';

/**
 * The Jev pilot on job email (plan #1165): which stored messages it reads,
 * and how its answers are counted. Pure, so both are tested without a
 * database; the job that asks Jev is inngest/jobs/cron/jev-trial.ts.
 */

/** The trial's name in job_search.jev_trial_answers. A second run takes a new one. */
export const JEV_JOB_EMAIL_TRIAL = 'job-email-2026-09';

/**
 * Not-relevant mail the rules threw out on the sender alone. There are
 * thousands and they say little about Haiku, so only this many go in, picked
 * by a hash of the id so every run picks the same ones.
 */
export const NOT_RELEVANT_SAMPLE = 60;

/**
 * The error the pipeline's "not a real pursuit" writes on the mail it
 * disclaims (app/jobs/(app)/pipeline/actions.ts). It is the one place the
 * person relabels job email by hand: the review queue's dismiss also writes
 * not_relevant but leaves nothing to tell it from the automatic kind.
 */
const HAND_DISMISSED = 'Dismissed: you said this was not a real pursuit';

export type LedgerRow = {
  id: string;
  classification: string;
  parse_confidence: number | string | null;
  error: string | null;
};

/** The label the person gave the message by hand, or null. */
export function handLabelFor(row: Pick<LedgerRow, 'error'>): string | null {
  return row.error?.startsWith(HAND_DISMISSED) ? 'not_relevant' : null;
}

function sampleKey(trial: string, id: string): string {
  return createHash('md5').update(`${trial}:${id}`).digest('hex');
}

/**
 * The messages the trial reads, in a stable order.
 *
 * Every message with a job label. Every not-relevant one Haiku read (it has a
 * confidence) or the person relabelled. Then NOT_RELEVANT_SAMPLE of the rest.
 */
export function pickTrialSample<R extends LedgerRow>(
  rows: readonly R[],
  opts: { trial?: string; notRelevantSample?: number } = {},
): R[] {
  const trial = opts.trial ?? JEV_JOB_EMAIL_TRIAL;
  const extra = opts.notRelevantSample ?? NOT_RELEVANT_SAMPLE;
  const byKey = (a: R, b: R) => sampleKey(trial, a.id).localeCompare(sampleKey(trial, b.id));

  const kept: R[] = [];
  const rest: R[] = [];
  for (const row of rows) {
    const read =
      row.classification !== 'not_relevant' ||
      row.parse_confidence !== null ||
      handLabelFor(row) !== null;
    (read ? kept : rest).push(row);
  }
  return [...kept.sort(byKey), ...rest.sort(byKey).slice(0, extra)];
}

/**
 * What the trial does when Jev gives no answer. `stop` ends the run: a
 * missing or refused key fails every message the same way, and writing a row
 * for each would only have to be deleted. `store` keeps the failure as the
 * message's row, for a refusal that is about that message (a 422 for text
 * over 32k tokens) or an answer that could not be read. `retry` writes
 * nothing, so the next run asks again.
 */
export function onJevFailure(failure: { reason: string; detail: string }): 'stop' | 'store' | 'retry' {
  if (failure.reason === 'no-key') return 'stop';
  if (failure.reason === 'refused') return /^40[13]\b/.test(failure.detail) ? 'stop' : 'store';
  if (failure.reason === 'malformed') return 'store';
  return 'retry';
}

/** A run of failures this long in a row ends the run, whatever the reason. */
export const MAX_FAILURES_IN_A_ROW = 5;

export type TrialAnswer = {
  message_id: string;
  stored_label: string;
  stored_confidence: number | string | null;
  hand_label: string | null;
  tier_a_label: string | null;
  tier_a_tier: string | null;
  jev_label: string | null;
  jev_confidence: number | string | null;
  failure: string | null;
};

/**
 * Who settled the stored label. `rules` when Tier A, reading the body now,
 * lands on the stored label with full confidence: reconcileClassification
 * keeps Tier A's label then, whatever Haiku said. `haiku` when Haiku read it
 * (it left a confidence) and the rules did not settle it. Rows with neither
 * were decided by the rules on the envelope and never reached a model.
 */
export function decidedBy(row: TrialAnswer): 'rules' | 'haiku' {
  const rulesSure =
    row.tier_a_tier === 'A' &&
    row.tier_a_label === row.stored_label &&
    row.tier_a_label !== 'not_relevant';
  if (rulesSure) return 'rules';
  return row.stored_confidence !== null ? 'haiku' : 'rules';
}

export type LabelLine = {
  label: string;
  messages: number;
  agree: number;
  /** Jev's confidence under the floor: these would go to Haiku in the rollout. */
  unsure: number;
  /** Agreement among the answers at or above the floor, the ones Jev would keep. */
  sureMessages: number;
  sureAgree: number;
};

export type Disagreement = {
  message_id: string;
  stored: string;
  jev: string;
  confidence: number;
  decidedBy: 'rules' | 'haiku';
  hand: string | null;
};

export type TrialSummary = {
  answered: number;
  failed: Record<string, number>;
  agree: number;
  unsure: number;
  sureMessages: number;
  sureAgree: number;
  byLabel: LabelLine[];
  byDecider: Record<'rules' | 'haiku', { messages: number; agree: number; sureMessages: number; sureAgree: number }>;
  /** Against the person's own labels, where there are any. */
  hand: { messages: number; jevRight: number; storedRight: number };
  disagreements: Disagreement[];
};

function num(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function summariseTrial(rows: readonly TrialAnswer[], floor = 0.8): TrialSummary {
  const summary: TrialSummary = {
    answered: 0,
    failed: {},
    agree: 0,
    unsure: 0,
    sureMessages: 0,
    sureAgree: 0,
    byLabel: [],
    byDecider: {
      rules: { messages: 0, agree: 0, sureMessages: 0, sureAgree: 0 },
      haiku: { messages: 0, agree: 0, sureMessages: 0, sureAgree: 0 },
    },
    hand: { messages: 0, jevRight: 0, storedRight: 0 },
    disagreements: [],
  };
  const lines = new Map<string, LabelLine>();

  for (const row of rows) {
    if (row.jev_label === null) {
      const reason = row.failure ?? 'unknown';
      summary.failed[reason] = (summary.failed[reason] ?? 0) + 1;
      continue;
    }
    const confidence = num(row.jev_confidence) ?? 0;
    const agree = row.jev_label === row.stored_label;
    const sure = confidence >= floor;
    const decider = decidedBy(row);

    summary.answered += 1;
    if (agree) summary.agree += 1;
    if (!sure) summary.unsure += 1;
    if (sure) {
      summary.sureMessages += 1;
      if (agree) summary.sureAgree += 1;
    }

    const line = lines.get(row.stored_label) ?? {
      label: row.stored_label,
      messages: 0,
      agree: 0,
      unsure: 0,
      sureMessages: 0,
      sureAgree: 0,
    };
    line.messages += 1;
    if (agree) line.agree += 1;
    if (!sure) line.unsure += 1;
    if (sure) {
      line.sureMessages += 1;
      if (agree) line.sureAgree += 1;
    }
    lines.set(row.stored_label, line);

    const by = summary.byDecider[decider];
    by.messages += 1;
    if (agree) by.agree += 1;
    if (sure) {
      by.sureMessages += 1;
      if (agree) by.sureAgree += 1;
    }

    if (row.hand_label !== null) {
      summary.hand.messages += 1;
      if (row.jev_label === row.hand_label) summary.hand.jevRight += 1;
      if (row.stored_label === row.hand_label) summary.hand.storedRight += 1;
    }

    if (!agree) {
      summary.disagreements.push({
        message_id: row.message_id,
        stored: row.stored_label,
        jev: row.jev_label,
        confidence,
        decidedBy: decider,
        hand: row.hand_label,
      });
    }
  }

  summary.byLabel = [...lines.values()].sort(
    (a, b) => b.messages - a.messages || a.label.localeCompare(b.label),
  );
  summary.disagreements.sort((a, b) => b.confidence - a.confidence);
  return summary;
}
