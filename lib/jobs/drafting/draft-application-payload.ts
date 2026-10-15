/**
 * Shape, checks and prompt text for drafting a whole application (plan
 * #2130.3). Kept free of server-only imports so the rules can be tested
 * directly; the model call is in ./draft-application.ts.
 *
 * Each answer goes through parseDraftPayload, the single-question drafter's
 * check, so a citation the bank does not hold and a banned construction are
 * caught the same way here. Two checks are new: the length of each answer
 * against its limit, counted in code, and the questions Dash asks back, each
 * tied to an answer on this application or to the application as a whole.
 *
 * parseDraftAsks, toStoredDraft and the limit helpers in ./limits.ts are
 * meant to be shared with the cover letter drafter.
 */
import { parseDraftPayload, type AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import { describeLimit, describeOverrun, overLimit, type AnswerLimit } from './limits';
import { renderQuestion } from './render';
import type { DraftsInput, StoredAsk, StoredDraft } from './store';
import type { GatheredQuestion } from './types';

/** The tool the model reports every draft through. */
export const APPLICATION_DRAFT_TOOL = 'report_drafts';

/** At most this many questions back about one answer. */
export const ASKS_PER_ANSWER = 2;
/** At most this many questions back in one run. */
export const MAX_ASKS = 8;
/** The earlier replies sent with a run, newest first. */
const REPLIES_SENT = 30;

/** One drafted answer, keyed by the application_answers row it is for. */
export type DraftedAnswer = AnswerDraft & { answerId: string };

/** A question Dash asks back, before it is given an id and stored. */
export type DraftAsk = { answerId: string | null; question: string };

export type ApplicationDraftPayload = {
  answers: DraftedAnswer[];
  asks: DraftAsk[];
  /** Answer ids asked for that came back with no usable draft. */
  missing: string[];
};

export type ApplicationDraftParse =
  | { ok: true; payload: ApplicationDraftPayload }
  | { ok: false; error: string };

type Row = Record<string, unknown>;

/** A tool input field the model sometimes sends as a JSON string. */
function list(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normal(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The questions Dash asks back, checked.
 *
 * An ask tied to an answer id this application does not have is kept as a
 * question about the application as a whole rather than dropped: the
 * question still stands. Repeats, and questions already asked before (by
 * their wording), are dropped, and the count is capped per answer and in all.
 */
export function parseDraftAsks(
  raw: unknown,
  knownAnswerIds: readonly string[],
  options: { askedBefore?: readonly string[]; perAnswer?: number; max?: number } = {},
): DraftAsk[] {
  const entries = list(raw) ?? [];
  const known = new Set(knownAnswerIds);
  const seen = new Set((options.askedBefore ?? []).map(normal));
  const perAnswer = options.perAnswer ?? ASKS_PER_ANSWER;
  const max = options.max ?? MAX_ASKS;
  const counts = new Map<string | null, number>();
  const out: DraftAsk[] = [];

  for (const entry of entries) {
    if (out.length >= max) break;
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!question || seen.has(normal(question))) continue;
    const answerId = typeof row.answer_id === 'string' && known.has(row.answer_id) ? row.answer_id : null;
    const count = counts.get(answerId) ?? 0;
    if (count >= perAnswer) continue;
    counts.set(answerId, count + 1);
    seen.add(normal(question));
    out.push({ answerId, question });
  }
  return out;
}

/**
 * Validate the drafts that came back.
 *
 * `requested` is the answer ids this call asked for; an entry for any other
 * id is ignored, and a requested id with no usable entry is listed as
 * missing. `known` is every answer id on the application, which asks may
 * name. Each answer's length is measured against its limit in `limits`.
 */
export function parseApplicationDraftPayload(
  raw: unknown,
  context: {
    requested: readonly string[];
    known: readonly string[];
    offeredEvidenceIds: readonly string[];
    banned: readonly string[];
    limits: Readonly<Record<string, AnswerLimit | null>>;
    askedBefore?: readonly string[];
  },
): ApplicationDraftParse {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'The drafts came back in an unexpected shape.' };
  }
  const entries = list((raw as Row).answers);
  if (!entries) return { ok: false, error: 'The drafts came back in an unexpected shape.' };

  const requested = new Set(context.requested);
  const answers: DraftedAnswer[] = [];
  const done = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const answerId = typeof row.answer_id === 'string' ? row.answer_id : null;
    if (!answerId || !requested.has(answerId) || done.has(answerId)) continue;
    const parsed = parseDraftPayload(
      { answer: row.answer, evidence_item_ids: list(row.evidence_item_ids), unsupported_claims: list(row.unsupported_claims) },
      context.offeredEvidenceIds,
      context.banned,
    );
    if (!parsed.ok) continue;
    done.add(answerId);
    const overrun = overLimit(parsed.draft.text, context.limits[answerId]);
    answers.push({ answerId, ...parsed.draft, ...(overrun ? { overLimit: overrun } : {}) });
  }

  if (answers.length === 0) return { ok: false, error: 'No drafts came back.' };

  return {
    ok: true,
    payload: {
      answers,
      asks: parseDraftAsks((raw as Row).asks, context.known, { askedBefore: context.askedBefore }),
      missing: context.requested.filter((id) => !done.has(id)),
    },
  };
}

/** A draft as application_drafts keeps it. */
export function toStoredDraft(draft: AnswerDraft): StoredDraft {
  return {
    answer: draft.text,
    evidence_item_ids: draft.evidenceItemIds,
    unsupported_claims: draft.unsupportedClaims,
    ...(draft.bannedFound.length > 0 ? { banned_found: draft.bannedFound } : {}),
    ...(draft.overLimit ? { over_limit: draft.overLimit } : {}),
  };
}

/** A stored draft in the shape the Application tab's draft card reads. */
export function fromStoredDraft(stored: StoredDraft): AnswerDraft {
  return {
    text: stored.answer,
    evidenceItemIds: stored.evidence_item_ids,
    unsupportedClaims: stored.unsupported_claims,
    bannedFound: stored.banned_found ?? [],
    ...(stored.over_limit ? { overLimit: stored.over_limit } : {}),
  };
}

/**
 * The questions a run drafts: the ones named, or every one with no answer.
 * A named id that is not on this application is refused rather than skipped.
 */
export function questionsToDraft(
  questions: readonly GatheredQuestion[],
  answerIds?: readonly string[],
): { ok: true; selected: GatheredQuestion[] } | { ok: false; error: string } {
  if (answerIds && answerIds.length > 0) {
    const byId = new Map(questions.map((q) => [q.answerId, q]));
    const selected: GatheredQuestion[] = [];
    for (const id of new Set(answerIds)) {
      const question = byId.get(id);
      if (!question) return { ok: false, error: 'That question is not on this application.' };
      selected.push(question);
    }
    return { ok: true, selected };
  }
  const selected = questions.filter((q) => !q.answer?.trim());
  if (selected.length === 0) {
    return {
      ok: false,
      error:
        questions.length === 0
          ? 'This application has no questions to draft.'
          : 'Every question on this application has an answer already.',
    };
  }
  return { ok: true, selected };
}

/**
 * The earlier asks that outlast a run over `drafting`: every one with a
 * reply, and the unanswered ones about answers not being redrafted (or about
 * the whole application, when only some answers are).
 */
export function standingAsks(
  asks: readonly StoredAsk[],
  drafting: ReadonlySet<string>,
  wholeApplication: boolean,
): StoredAsk[] {
  return asks.filter((ask) => {
    if (ask.reply !== null) return true;
    return ask.answer_id === null ? !wholeApplication : !drafting.has(ask.answer_id);
  });
}

/**
 * The stored draft after a run.
 *
 * Drafts from earlier runs for other questions stay. Asks the person has
 * replied to always stay, since a reply is a fact about them that later runs
 * use. An unanswered ask is replaced when its answer was redrafted, or, for
 * one about the whole application, when the whole application was.
 */
export function mergeApplicationDrafts(
  existing: DraftsInput | null,
  run: { answers: readonly DraftedAnswer[]; asks: readonly DraftAsk[]; wholeApplication: boolean },
  newId: () => string,
): DraftsInput {
  const drafts = { ...(existing?.drafts ?? {}) };
  const redrafted = new Set<string>();
  for (const answer of run.answers) {
    drafts[answer.answerId] = toStoredDraft(answer);
    redrafted.add(answer.answerId);
  }
  const kept = standingAsks(existing?.asks ?? [], redrafted, run.wholeApplication);
  const fresh: StoredAsk[] = run.asks.map((ask) => ({
    id: newId(),
    answer_id: ask.answerId,
    question: ask.question,
    reply: null,
  }));
  return { drafts, asks: [...kept, ...fresh] };
}

/** "answer <id>" or "the application as a whole", for the replies section. */
function about(answerId: string | null): string {
  return answerId ? `answer id ${answerId}` : 'the application as a whole';
}

/** What they replied to earlier asks, as facts the drafts may use. */
export function renderReplies(asks: readonly StoredAsk[]): string | null {
  const answered = asks.filter((ask) => ask.reply !== null).slice(-REPLIES_SENT).reverse();
  if (answered.length === 0) return null;
  return answered
    .map((ask) => `About ${about(ask.answer_id)}:\nYou asked: ${ask.question}\nThey said: ${ask.reply}`)
    .join('\n\n');
}

/**
 * The user turn of a run: the questions to draft, the ones already answered
 * on this application (so the drafts tell different stories), and their
 * replies to earlier asks. The material it draws on is in the system prompt.
 */
export function renderDraftRequest(input: {
  selected: readonly GatheredQuestion[];
  others: readonly GatheredQuestion[];
  asks: readonly StoredAsk[];
  wholeApplication: boolean;
}): string {
  const answeredElsewhere = input.others.filter((q) => q.answer?.trim());
  const replies = renderReplies(input.asks);
  const drafting = new Set(input.selected.map((q) => q.answerId));
  // Unanswered asks about the answers being redrafted are replaced by this
  // run's, so only the ones that stay are listed as not to be asked again.
  const pending = standingAsks(input.asks, drafting, input.wholeApplication)
    .filter((ask) => ask.reply === null)
    .map((ask) => `- ${ask.question}`);
  return [
    `## The questions to answer now\n\n${input.selected.map(renderQuestion).join('\n\n---\n\n')}`,
    answeredElsewhere.length > 0
      ? `## Answered already on this application\n\nDo not draft these. Read them so the new answers tell different stories.\n\n${answeredElsewhere.map(renderQuestion).join('\n\n---\n\n')}`
      : null,
    replies ? `## What they told you when you asked before\n\nThese are facts about them.\n\n${replies}` : null,
    pending.length > 0 ? `## Asked before and not yet answered\n\nDo not ask these again.\n\n${pending.join('\n')}` : null,
    `Call ${APPLICATION_DRAFT_TOOL} with a draft for every answer id under "The questions to answer now".`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The corrective turn for answers over their limits. */
export function renderRetryRequest(
  over: readonly DraftedAnswer[],
  limits: Readonly<Record<string, AnswerLimit | null>>,
): string {
  const lines = over.map((answer) => {
    const limit = limits[answer.answerId];
    const overrun = answer.overLimit;
    return `- answer id ${answer.answerId}: ${overrun ? describeOverrun(overrun) : 'over its limit'}${limit ? ` (limit ${describeLimit(limit)})` : ''}`;
  });
  return [
    'These answers are over their limits:',
    lines.join('\n'),
    `Call ${APPLICATION_DRAFT_TOOL} again with only these answers, each cut to about nine tenths of its limit. Keep what each says and what it cites; cut words, not substance. A character limit counts every character, spaces included. Leave asks empty.`,
  ].join('\n\n');
}
