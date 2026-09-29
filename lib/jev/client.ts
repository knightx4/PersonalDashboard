import 'server-only';

import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

/**
 * One question to Jev, TypeSafe's classifier, and the only place this app
 * knows how their API is shaped.
 *
 * Feature #1161 moves the steps that only pick a label, answer yes or no, or
 * rate something from Haiku to Jev: it answers in well under a second, charges
 * $0.042 per million input tokens with output free, and says how sure it is.
 * Haiku stays as the fallback (lib/jev/decide.ts).
 *
 * The wire format is from docs.typesafe.ai/api as of September 2026:
 * `POST https://api.typesafe.ai/v1/systemone` with a bearer key, a `state`,
 * a `model` and a map of named questions; one answer comes back per name,
 * with `usage.input_tokens` and `usage.output_tokens`. It lives in
 * `jevRequestBody` and `parseJevAnswer` and nowhere else.
 *
 * Never throws. Every way a call can fail is an ordinary outcome, and the
 * caller's answer to all of them is the same: ask Haiku instead.
 */

/**
 * Pinned rather than `jev-latest`. The alias moves when TypeSafe ships a new
 * version, which would change answers under a confidence floor tuned on this
 * one, and the rate in lib/core/spend/pricing.ts is keyed by this name.
 */
export const JEV_MODEL = 'jev-1.13.0';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** Jev answers in 70 to 500 ms. Past this the fallback is the faster route. */
const TIMEOUT_MS = 10_000;
/** The name the one question is sent under. TypeSafe does not show it to the model. */
const QUESTION_ID = 'answer';

/**
 * The three kinds of question Jev takes, in this app's words. TypeSafe calls
 * them Choice, Noul and Score.
 *
 * `options` maps each label to what it means, or null when the label says it
 * all; at most 255. `levels` runs from lowest to highest, two to ten of them.
 */
export type JevQuestion =
  | { type: 'choice'; question: string; options: Readonly<Record<string, string | null>> }
  | { type: 'yes-no'; question: string; yes?: string; no?: string }
  | { type: 'score'; question: string; levels: readonly string[] };

export type JevChoiceAnswer<L extends string = string> = {
  type: 'choice';
  choice: L;
  confidence: number;
  probabilities: Record<L, number>;
};

export type JevYesNoAnswer = {
  type: 'yes-no';
  yes: boolean;
  /** Jev's probability that the answer is yes. */
  probability: number;
  /**
   * TypeSafe returns no confidence on a yes/no answer, so this is worked out
   * from the probability with their own formula for a two-option choice:
   * `|2p - 1|`. A 0.9 yes and a 0.1 yes are both 0.8.
   */
  confidence: number;
};

export type JevScoreAnswer = {
  type: 'score';
  /** Probability-weighted, from 0 to levels - 1; can fall between levels. */
  score: number;
  /** The nearest level's index. */
  level: number;
  confidence: number;
  /** One per level, in order. */
  probabilities: number[];
};

export type JevAnswer = JevChoiceAnswer | JevYesNoAnswer | JevScoreAnswer;

/** The answer type that goes with a question type, with a choice's labels kept. */
export type JevAnswerFor<Q extends JevQuestion> = Q extends { type: 'choice'; options: infer O }
  ? JevChoiceAnswer<Extract<keyof O, string>>
  : Q extends { type: 'yes-no' }
    ? JevYesNoAnswer
    : JevScoreAnswer;

export type JevFailure = {
  ok: false;
  /**
   * `no-key` when TYPESAFE_API_KEY is not set. `rate-limited` (429) and
   * `overloaded` (529) are TypeSafe asking for a pause; `refused` is a bad key
   * (401, 403) or a request it would not take (422 and other 4xx).
   */
  reason: 'no-key' | 'rate-limited' | 'overloaded' | 'refused' | 'timeout' | 'malformed' | 'error';
  detail: string;
};

export type JevResult<A extends JevAnswer = JevAnswer> =
  | { ok: true; answer: A; /** The versioned model that answered. */ model: string }
  | JevFailure;

/**
 * What Jev reads. Text, or structured data it can refer to by field name. The
 * state and the question together must fit in 32k tokens; a longer one is
 * refused with a 422, which the caller's fallback then handles.
 */
export type JevState = string | Record<string, unknown> | unknown[];

export type AskJevInput<Q extends JevQuestion> = {
  state: JevState;
  question: Q;
  /**
   * Where the cost goes. Called once for every response that reported usage,
   * whether or not its answer could be read, with the model it names.
   */
  onSpend?: SpendSink;
  /** Falls back to TYPESAFE_API_KEY, which is what the deployment sets. */
  apiKey?: string | null;
  /** Tests hand in their own. */
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** The key the deployment sets, or null. */
export function jevApiKey(): string | null {
  return process.env.TYPESAFE_API_KEY?.trim() || null;
}

/** The body sent to TypeSafe. Exported so a test can read it without a network. */
export function jevRequestBody(
  state: JevState,
  question: JevQuestion,
  model: string = JEV_MODEL,
): Record<string, unknown> {
  let wire: Record<string, unknown>;
  switch (question.type) {
    case 'choice':
      wire = { type: 'choice', instructions: question.question, criteria: question.options };
      break;
    case 'yes-no': {
      const criteria: Record<string, string> = {};
      if (question.yes) criteria.true = question.yes;
      if (question.no) criteria.false = question.no;
      wire = { type: 'noul', instructions: question.question };
      if (Object.keys(criteria).length > 0) wire.criteria = criteria;
      break;
    }
    case 'score':
      wire = { type: 'score', instructions: question.question, criteria: [...question.levels] };
      break;
  }
  return { state, model, questions: { [QUESTION_ID]: wire } };
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** The versioned model a response names, or the one that was asked for. */
function answeringModel(body: unknown): string {
  const named = body && typeof body === 'object' ? (body as Record<string, unknown>).model : null;
  return typeof named === 'string' && named.trim() ? named.trim() : JEV_MODEL;
}

function malformed(detail: string): JevFailure {
  return { ok: false, reason: 'malformed', detail };
}

/**
 * Turn a response body into the answer to the question that was asked, or
 * say why it cannot be. Checks the answer against the question: a choice
 * outside the options, or a score with the wrong number of levels, is
 * malformed rather than passed on.
 */
export function parseJevAnswer<Q extends JevQuestion>(
  body: unknown,
  question: Q,
): JevResult<JevAnswerFor<Q>> {
  if (!body || typeof body !== 'object') return malformed('response was not an object');
  const top = body as Record<string, unknown>;
  const model = answeringModel(body);
  const answers = top.answers;
  if (!answers || typeof answers !== 'object') return malformed('response carried no answers');
  const raw = (answers as Record<string, unknown>)[QUESTION_ID];
  if (!raw || typeof raw !== 'object') return malformed('response carried no answer to the question');
  const wire = raw as Record<string, unknown>;

  const ok = (answer: JevAnswer) =>
    ({ ok: true, answer: answer as JevAnswerFor<Q>, model }) as JevResult<JevAnswerFor<Q>>;

  switch (question.type) {
    case 'choice': {
      const labels = Object.keys(question.options);
      const choice = wire.choice;
      if (typeof choice !== 'string' || !labels.includes(choice)) {
        return malformed('the choice was not one of the options');
      }
      if (!isUnit(wire.confidence)) return malformed('the choice carried no confidence');
      const given = (wire.probabilities ?? {}) as Record<string, unknown>;
      const probabilities: Record<string, number> = {};
      for (const label of labels) probabilities[label] = isUnit(given[label]) ? given[label] : 0;
      return ok({ type: 'choice', choice, confidence: wire.confidence, probabilities });
    }
    case 'yes-no': {
      const probability = wire.noul;
      if (!isUnit(probability)) return malformed('the yes/no answer carried no probability');
      return ok({
        type: 'yes-no',
        yes: probability >= 0.5,
        probability,
        confidence: Math.abs(2 * probability - 1),
      });
    }
    case 'score': {
      const count = question.levels.length;
      const score = wire.score;
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > count - 1) {
        return malformed('the score was outside the levels');
      }
      if (!isUnit(wire.confidence)) return malformed('the score carried no confidence');
      const given = (wire.probabilities ?? {}) as Record<string, unknown>;
      const probabilities = question.levels.map((_, index) => {
        const value = given[String(index)];
        return isUnit(value) ? value : 0;
      });
      return ok({
        type: 'score',
        score,
        level: Math.round(score),
        confidence: wire.confidence,
        probabilities,
      });
    }
  }
}

/** Ask Jev one question about one state. Never throws. */
export async function askJev<Q extends JevQuestion>(
  input: AskJevInput<Q>,
): Promise<JevResult<JevAnswerFor<Q>>> {
  const apiKey = input.apiKey?.trim() || jevApiKey();
  if (!apiKey) return { ok: false, reason: 'no-key', detail: 'TYPESAFE_API_KEY is not set' };

  const fetchImpl = input.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(jevRequestBody(input.state, input.question)),
      signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    // The message only: the request carries the person's email or note text.
    return {
      ok: false,
      reason: timedOut ? 'timeout' : 'error',
      detail: error instanceof Error ? error.message : 'request failed',
    };
  }

  if (!response.ok) {
    const status = response.status;
    const reason: JevFailure['reason'] =
      status === 429
        ? 'rate-limited'
        : status === 529
          ? 'overloaded'
          : status >= 400 && status < 500
            ? 'refused'
            : 'error';
    // TypeSafe's error body names the field it objected to, never the state.
    const text = await response.text().catch(() => '');
    return { ok: false, reason, detail: `${status}${text ? `: ${text.slice(0, 200)}` : ''}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return malformed('response was not JSON');
  }

  const result = parseJevAnswer(body, input.question);
  const usage = body && typeof body === 'object' ? (body as Record<string, unknown>).usage : undefined;
  if (usage !== undefined) input.onSpend?.({ model: answeringModel(body), usage: usageFrom(usage) });
  return result;
}
