/**
 * A piece of work handed to a goal from a chat (plan #2778.8).
 *
 * Asking Ask Dash or a Claude chat to figure something out for a goal ("should
 * I consolidate my loans") starts a goals run on that goal with the question
 * on its row (goals.runs.question, origin, origin_ref; goals 0092). The goal's
 * Dashboard shows it under Dash is on while it runs. When it ends, the
 * five-minute job (lib/goals/take-on-report.ts) sends a notification and, for
 * Ask Dash, writes a reply line into the conversation, both opening the goal at
 * the result. What the run suggests waits in goals.suggestions on Add and No.
 *
 * Pure: picking the goal, the brief, the link, the notification and the reply.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import { firstSentence } from '@/lib/goals/first-sentence';
import type { PushPayload } from '@/lib/push/send';

/** Where a question came from, as goals.runs.origin keeps it. */
export const TAKE_ON_ORIGINS = ['ask_dash', 'chat', 'goal_page'] as const;
export type TakeOnOrigin = (typeof TAKE_ON_ORIGINS)[number];

/** The longest question a run keeps (runs_question_ck). */
export const QUESTION_MAX = 4000;

/** How long a finished question's result stays on the Dashboard without its link. */
export const RESULT_SHOWN_MS = 24 * 60 * 60 * 1000;

/** The most goals named when asking which one. */
export const CANDIDATES_MAX = 6;

/** The goal at the result: its Dashboard, scrolled to that work. */
export function takeOnHref(goalId: string, runId: string): string {
  return `/goals/${goalId}?work=${runId}#work-${runId}`;
}

/** The anchor of one piece of work on the Dashboard. */
export function workAnchor(runId: string): string {
  return `work-${runId}`;
}

// ---------------------------------------------------------------------------
// Picking the goal
// ---------------------------------------------------------------------------

const STOP = new Set([
  'about', 'after', 'also', 'and', 'any', 'are', 'but', 'can', 'could', 'did', 'does', 'for', 'from',
  'get', 'goal', 'had', 'has', 'have', 'how', 'into', 'its', 'just', 'like', 'make', 'more', 'most',
  'much', 'need', 'not', 'now', 'off', 'one', 'our', 'out', 'over', 'should', 'some', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'this', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your', 'figure', 'work', 'out', 'think', 'want', 'way',
]);

/** The words that carry meaning, lower-cased, a plural s taken off. */
export function keyWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Set<string>();
  for (const word of words) {
    if (word.length < 3 || STOP.has(word)) continue;
    out.add(word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  }
  return out;
}

export type GoalChoice = { id: string; title: string; acceptance?: string | null };

export type GoalPick =
  | { kind: 'goal'; goal: GoalChoice }
  | { kind: 'ask'; candidates: GoalChoice[] };

/**
 * The goal a question is about: the one whose title (and done-when, at half
 * weight) shares the most words with it, when it shares more than any other.
 * A tie or no match at all asks which, naming the likeliest goals first.
 */
export function pickGoal(question: string, goals: readonly GoalChoice[]): GoalPick {
  const asked = keyWords(question);
  const scored = goals.map((goal) => {
    let score = 0;
    for (const word of keyWords(goal.title)) if (asked.has(word)) score += 2;
    for (const word of keyWords(goal.acceptance ?? '')) if (asked.has(word)) score += 1;
    return { goal, score };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (top && top.score > 0 && (!second || top.score > second.score)) return { kind: 'goal', goal: top.goal };
  const matched = ranked.filter((entry) => entry.score > 0);
  const named = (matched.length > 0 ? matched : ranked).slice(0, CANDIDATES_MAX).map((entry) => entry.goal);
  return { kind: 'ask', candidates: named };
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

const ORIGIN_WORDS: Record<TakeOnOrigin, string> = {
  ask_dash: 'in Ask Dash',
  chat: 'in a Claude chat',
  goal_page: 'on the goal page',
};

/** The brief for a question run: answer it on the goal, suggest rather than change. */
export function takeOnRunText(input: {
  goalId: string;
  goalTitle: string;
  userId: string;
  runId: string;
  question: string;
  origin: TakeOnOrigin;
}): string {
  return [
    `Figure something out for one goal: "${input.goalTitle}" (goals.items id ${input.goalId}).`,
    '',
    `They asked ${ORIGIN_WORDS[input.origin]}, in their words:`,
    '',
    ...input.question.trim().split('\n').map((line) => `> ${line}`),
    '',
    'Follow .claude/skills/goals/SKILL.md, and read reference/question.md before your first write:',
    'it says how to answer a question handed to a goal. In short: read the goal and what their',
    'records hold, research what the question needs, and write the answer as one file on the goal',
    '(reference/files.md). Do not add, change or close steps and do not change the dashboard: put',
    'each step or tile you would add in goals.suggestions with this run id, kind step or tile,',
    'where they wait on Add and No.',
    '',
    `The goals belong to user_id ${input.userId}. This run is goals.runs id ${input.runId},`,
    'already written as started with the question on it. Set goals.run_id to it on every write,',
    'and close that row with a summary whose first sentence answers the question (or as failed,',
    'with the reason) before you stop. The app reports back from that sentence.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reporting back
// ---------------------------------------------------------------------------

/** A question run that ended and has not been reported. */
export type EndedQuestion = {
  runId: string;
  userId: string;
  goalId: string | null;
  goalTitle: string | null;
  question: string;
  origin: TakeOnOrigin;
  /** The Ask Dash conversation the reply goes into; null for the other origins. */
  originRef: string | null;
  status: 'done' | 'failed';
  summary: string | null;
  error: string | null;
  /** Steps and tiles it suggested that wait on Add. */
  suggested: number;
};

function quoteOf(question: string): string {
  return question.replace(/\s+/g, ' ').trim();
}

export function takeOnPayload(run: EndedQuestion): PushPayload {
  const question = quoteOf(run.question);
  const done = run.status === 'done';
  const answer = done ? firstSentence(run.summary) : '';
  const waiting = done && run.suggested > 0 ? suggestedLine(run.suggested) : '';
  const body = done
    ? [answer, waiting].filter(Boolean).join(' ') || 'The answer is on the goal.'
    : `Dash could not finish it: ${firstSentence(run.error) || 'the run failed.'}`;
  return {
    title: clip(`${done ? 'Done' : 'Stopped'}: ${question}`, TITLE_MAX),
    body: clip(body, BODY_MAX),
    url: run.goalId ? takeOnHref(run.goalId, run.runId) : '/goals',
    tag: `goal-work-${run.runId}`,
  };
}

function suggestedLine(n: number): string {
  return n === 1 ? 'One suggestion waits on Add.' : `${n} suggestions wait on Add.`;
}

/** The reply line written into the Ask Dash conversation the question came from. */
export function takeOnReply(run: EndedQuestion): {
  body: string;
  citations: { table: string; ref: string; title: string; href: string }[];
} {
  const question = quoteOf(run.question);
  const goal = run.goalTitle ?? 'the goal';
  const lines =
    run.status === 'done'
      ? [
          `Done: ${question}`,
          firstSentence(run.summary) || 'The answer is on the goal.',
          run.suggested > 0
            ? `It is on ${goal}, where ${run.suggested === 1 ? 'one suggestion waits' : `${run.suggested} suggestions wait`} on Add.`
            : `The whole answer is on ${goal}.`,
        ]
      : [
          `I could not finish: ${question}`,
          firstSentence(run.error) || 'The run stopped before it had an answer.',
          `What it got to is on ${goal}.`,
        ];
  return {
    body: lines.join(' '),
    citations: run.goalId
      ? [{ table: 'goals.items', ref: run.goalId, title: goal, href: takeOnHref(run.goalId, run.runId) }]
      : [],
  };
}
