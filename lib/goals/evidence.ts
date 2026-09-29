import type { SpendSink } from '@/lib/core/spend/pricing';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';
import { askJevAll, type JevFailure, type JevQuestion } from '@/lib/jev/wire';

/**
 * The evidence the morning run closes steps from, filtered by Jev first
 * (plan #1176).
 *
 * The morning run closes each step of the person's it can see has happened
 * (the goals skill, "Closing a step from evidence"). Before this, the session
 * searched Jobs, Gmail, the calendar and Todo itself for every open step,
 * which meant reading a day's mail and records against a hundred steps. Now
 * every item that arrived since the last run (an email, a job event, a task
 * ticked off, a calendar event whose day has passed) is put to Jev once, with
 * one yes/no question per step: does this item bear on that step? Only the
 * pairs Jev says yes to reach the brief, and the session checks each against
 * the step's done-when as before.
 *
 * The filter is for recall. A pair is kept unless Jev is fairly sure it has
 * nothing to do with the step, because a pair wrongly kept costs the session
 * one look and a pair wrongly dropped is a close that never happens.
 *
 * When Jev cannot answer (no key, the account has not opted in, a failed
 * request), `filterEvidence` says so and the brief goes back to asking the
 * session to search for itself, as it did before.
 *
 * The reads are in lib/goals/evidence-store.ts. No `server-only` guard here,
 * so a script can try the question against real data under plain `tsx`.
 */

export type EvidenceSource = 'gmail' | 'jobs' | 'todo' | 'calendar';

export type EvidenceItem = {
  source: EvidenceSource;
  /** The row's id in its own table, which `line` names. */
  id: string;
  /** What Jev reads: the fields that say what the item is, and nothing else. */
  state: Record<string, string>;
  /** The item as the brief lists it, naming where the session can read it in full. */
  line: string;
};

/** A step of the person's that could close from evidence. */
export type EvidenceStep = {
  id: string;
  title: string;
  acceptance: string | null;
  goalTitle: string;
};

/**
 * Below this probability of "yes", Jev is taken to have said the item has
 * nothing to do with the step. Low on purpose: see the note on recall above.
 * Picked from a trial on 29 September 2026: fifteen items (three days of the
 * owner's mail, job events and ticked tasks, plus five made-up confirmations)
 * against twenty of their open steps. The six pairs that belong together
 * scored 0.28 to 0.96; the unrelated pairs scored a median of 0.02, and the
 * few above 0.2 were near misses worth a look (a contractor background check
 * against "Decide: contract or keep going").
 */
export const BEARS_ON_FLOOR = 0.2;

/**
 * Questions per request. Each carries a step's title and done-when, so forty
 * is about three thousand tokens, well inside the 32k TypeSafe allows for the
 * state and the questions together.
 */
export const QUESTIONS_PER_REQUEST = 40;

/** More items than this in one window and the newest are kept. */
export const EVIDENCE_ITEM_LIMIT = 150;

/** How far back the first run, or a run after a long gap, looks. */
export const EVIDENCE_WINDOW_DAYS = 7;

/**
 * One step's question, asked of every item. The last sentence is what keeps a
 * job email from bearing on every job step: without it Jev said yes to the
 * general topic, and a student-loan reminder scored 0.88 against a step about
 * refinancing some other day.
 */
export function bearsOnQuestion(step: EvidenceStep): JevQuestion {
  const doneWhen = step.acceptance?.trim();
  return {
    type: 'yes-no',
    question:
      `Could this item be a sign that the person did or progressed this specific task: "${step.title.trim()}"` +
      (doneWhen ? ` (done when: ${doneWhen})` : '') +
      '? Answer no when it is about a different company, person, account or task.',
  };
}

/**
 * The steps that can close from evidence: the person's own (`mine`), open,
 * under an open goal and reached through open steps only, with nothing open
 * beneath it. The skill's rule, "Only a `mine` step with nothing open beneath
 * it closes this way". Unlike the stale list, a step waiting on another or on
 * a start date is kept: if the evidence shows it happened, it happened.
 */
export function evidenceSteps(goals: Goal[], stepsByGoal: Map<string, StepNode[]>): EvidenceStep[] {
  const steps: EvidenceStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        const openBeneath = node.children.some((child) => child.status === 'open');
        if (node.kind === 'mine' && !openBeneath) {
          steps.push({ id: node.id, title: node.title, acceptance: node.acceptance, goalTitle: goal.title });
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return steps;
}

export type EvidenceMatch = { step: EvidenceStep; items: EvidenceItem[] };

export type FilteredEvidence =
  | {
      ok: true;
      /** The steps with at least one item bearing on them, in step order. */
      matches: EvidenceMatch[];
      /** How many items were read, for the run summary. */
      items: number;
    }
  | { ok: false; failure: JevFailure };

export type FilterEvidenceInput = {
  steps: EvidenceStep[];
  items: EvidenceItem[];
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Defaults to BEARS_ON_FLOOR. */
  floor?: number;
};

/** A small pool, so a morning's items do not queue one after another. */
const CONCURRENCY = 4;

/**
 * Put every item to Jev against every step, and keep the pairs that bear.
 *
 * One request per item and batch of forty steps: the item is the state and
 * each step is a named question, so an item is sent and charged once per
 * batch. Any request that fails fails the whole filter, because a brief built
 * from part of the items would tell the session it had seen everything when
 * it had not. An answer that comes back malformed keeps its pair.
 */
export async function filterEvidence(input: FilterEvidenceInput): Promise<FilteredEvidence> {
  const floor = input.floor ?? BEARS_ON_FLOOR;
  const kept = new Map<string, EvidenceItem[]>();
  if (input.steps.length === 0 || input.items.length === 0) {
    return { ok: true, matches: [], items: input.items.length };
  }

  const batches: EvidenceStep[][] = [];
  for (let i = 0; i < input.steps.length; i += QUESTIONS_PER_REQUEST) {
    batches.push(input.steps.slice(i, i + QUESTIONS_PER_REQUEST));
  }
  const jobs = input.items.flatMap((item) => batches.map((batch) => ({ item, batch })));

  let failure: JevFailure | null = null;
  let next = 0;
  const worker = async () => {
    while (failure === null && next < jobs.length) {
      const { item, batch } = jobs[next++];
      const questions: Record<string, JevQuestion> = {};
      batch.forEach((step, index) => {
        questions[`s${index}`] = bearsOnQuestion(step);
      });
      const result = await askJevAll({
        state: item.state,
        questions,
        onSpend: input.onSpend,
        apiKey: input.apiKey,
        fetch: input.fetch,
        timeoutMs: input.timeoutMs,
      });
      if (!result.ok) {
        failure ??= result;
        return;
      }
      batch.forEach((step, index) => {
        const answer = result.answers[`s${index}`];
        const bears = !answer.ok || answer.answer.type !== 'yes-no' || answer.answer.probability >= floor;
        if (!bears) return;
        const list = kept.get(step.id) ?? [];
        list.push(item);
        kept.set(step.id, list);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  if (failure) return { ok: false, failure };

  const matches = input.steps
    .filter((step) => kept.has(step.id))
    .map((step) => ({ step, items: kept.get(step.id)! }));
  return { ok: true, matches, items: input.items.length };
}

/**
 * The part of the morning brief that replaces "search Jobs, Gmail, the
 * calendar and Todo" once Jev has filtered: each step with the items that
 * bear on it, or the plain statement that none do.
 */
export function evidenceLines(matches: EvidenceMatch[], items: number): string[] {
  if (matches.length === 0) {
    return [
      `Jev read the ${items} new ${items === 1 ? 'item' : 'items'} since the last run (email, job`,
      'events, finished tasks, past calendar events) against every open step of the person\'s, and',
      'none bears on one. Close no step from evidence today.',
    ];
  }
  return [
    `Jev read the ${items} new ${items === 1 ? 'item' : 'items'} since the last run (email, job`,
    'events, finished tasks, past calendar events) against every open step of the person\'s. These',
    'are the ones that bear on a step. Check each against the step\'s whole done-when where it',
    'lives (Gmail for an email, Jobs, Todo or the calendar for the rest) and close the step only',
    'when it is met. Do not search for other evidence: anything not listed here was read and',
    'had nothing to do with an open step.',
    '',
    ...matches.flatMap(({ step, items: found }) => [
      `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}":`,
      ...found.map((item) => `  - ${item.line}`),
    ]),
  ];
}
