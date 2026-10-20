/**
 * Shape, checks and prompt pieces for a drafted cover letter (plan #2135.1).
 * Kept free of server-only imports so the rules can be tested directly; the
 * model call is in ./draft-cover-letter.ts.
 *
 * The checks are the single-answer drafter's (lib/jobs/evidence/draft-payload.ts):
 * an evidence id the model made up is surfaced as a claim it could not
 * ground, and banned constructions are found by a regex over the letter
 * rather than trusted to the instruction.
 */
import { z } from 'zod';
import { findBannedConstructions } from '@/lib/jobs/evidence/draft-payload';
import { LETTER_KEY, type DraftsInput, type StoredAsk } from './store';
import { renderVaultPassage } from './render';
import type { GatheredMaterial, GatheredQuestion, GatheredRequirement, VaultPassage } from './types';

/** A letter as the model reported it, checked. */
export interface CoverLetterDraft {
  letter: string;
  /** Evidence actually cited, filtered to what was offered. */
  evidenceItemIds: string[];
  /** Claims the model flagged as not grounded, plus a line for any invented id. */
  unsupportedClaims: string[];
  /** Banned constructions found in the letter, as written in the list. */
  bannedFound: string[];
  /** What the model asked the person, new this round. */
  asks: string[];
}

export type CoverLetterResult = { ok: true; draft: CoverLetterDraft } | { ok: false; error: string };

/** What the page shows for the current draft, fresh from a call or read back from the row. */
export interface CoverLetterDraftView {
  letter: string;
  words: number;
  evidenceItemIds: string[];
  unsupportedClaims: string[];
  bannedFound: string[];
  /** Every ask kept on the row: earlier ones the person answered, then this round's. */
  asks: StoredAsk[];
}

/**
 * Stock lines a letter is checked for on top of the person's own banned
 * constructions. Each is a phrase they struck from a draft, or the kind of
 * sentence that says how much they want the job instead of what they think.
 */
export const LETTER_BANNED = [
  'most companies',
  'I keep coming back to',
  'most want to own',
  'want to spend my time on',
  'excited',
  'exciting opportunity',
  'I am writing to apply',
  "I'd bring",
  'I would bring',
];

/** The person's banned constructions, then the letter's own. */
function letterBans(banned: readonly string[]): string[] {
  return [...banned, ...LETTER_BANNED];
}

/** At most this many questions back to the person in one round. */
export const MAX_ASKS = 4;

/** How many requirement matches the letter is pointed at. */
export const STRONGEST_COUNT = 3;

const payloadSchema = z.object({
  letter: z.string().trim().min(1),
  evidence_item_ids: z.array(z.string()).nullish(),
  unsupported_claims: z.array(z.string().trim().min(1)).nullish(),
  asks: z.array(z.string()).nullish(),
});

/** Validate the model's report against the evidence that was offered and the banned list. */
export function parseCoverLetterPayload(
  raw: unknown,
  offeredIds: readonly string[],
  banned: readonly string[],
): CoverLetterResult {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The cover letter came back in an unexpected shape.' };
  }

  const allowed = new Set(offeredIds);
  const ids = parsed.data.evidence_item_ids ?? [];
  const cited = [...new Set(ids)].filter((id) => allowed.has(id));
  const invented = ids.some((id) => !allowed.has(id));
  const unsupported = [...new Set(parsed.data.unsupported_claims ?? [])];

  const asks: string[] = [];
  for (const raw of parsed.data.asks ?? []) {
    const ask = raw.trim();
    if (ask && !asks.some((a) => a.toLowerCase() === ask.toLowerCase())) asks.push(ask);
  }

  return {
    ok: true,
    draft: {
      letter: parsed.data.letter,
      evidenceItemIds: cited,
      unsupportedClaims: invented
        ? [...unsupported, 'Part of this cited an evidence item that does not exist.']
        : unsupported,
      bannedFound: findBannedConstructions(parsed.data.letter, letterBans(banned)),
      asks: asks.slice(0, MAX_ASKS),
    },
  };
}

/** Words in a text, as a person would count them. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The requirements the letter should lean on: strong matches first, then
 * partial ones, each in gather()'s order (must-haves first). Requirements no
 * match has been run on are not matches, so none are returned for them.
 */
export function strongestMatches(
  requirements: readonly GatheredRequirement[],
  count = STRONGEST_COUNT,
): GatheredRequirement[] {
  return [
    ...requirements.filter((r) => r.verdict === 'strong'),
    ...requirements.filter((r) => r.verdict === 'partial'),
  ].slice(0, count);
}

/** The questions on the application that have an answer now. */
export function answeredQuestions(questions: readonly GatheredQuestion[]): GatheredQuestion[] {
  return questions.filter((q) => q.answer && q.answer.trim() !== '');
}

/**
 * Asks to keep on the row after a redraft: the earlier ones the person
 * answered, since their replies are facts the next redraft still needs, then
 * this round's. An earlier ask left unanswered is replaced by this round's,
 * and a new ask repeating an answered one is dropped.
 */
export function mergeAsks(
  earlier: readonly StoredAsk[],
  fresh: readonly string[],
  newId: () => string,
): StoredAsk[] {
  const answered = earlier.filter((ask) => ask.reply !== null);
  const seen = new Set(answered.map((ask) => ask.question.trim().toLowerCase()));
  const added: StoredAsk[] = [];
  for (const question of fresh) {
    const key = question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ id: newId(), answer_id: null, question, reply: null });
  }
  return [...answered, ...added];
}

/** What goes on the application_drafts row for a fresh letter. */
export function storedLetter(draft: CoverLetterDraft, asks: StoredAsk[]): DraftsInput {
  return {
    drafts: {
      [LETTER_KEY]: {
        answer: draft.letter,
        evidence_item_ids: draft.evidenceItemIds,
        unsupported_claims: draft.unsupportedClaims,
      },
    },
    asks,
  };
}

/**
 * The page's view of a stored letter, or null when the row holds none.
 * Banned constructions are not stored, so they are found again here against
 * the person's current list.
 */
export function coverLetterView(
  stored: DraftsInput | null,
  banned: readonly string[],
): CoverLetterDraftView | null {
  const entry = stored?.drafts[LETTER_KEY];
  if (!stored || !entry) return null;
  return {
    letter: entry.answer,
    words: countWords(entry.answer),
    evidenceItemIds: entry.evidence_item_ids,
    unsupportedClaims: entry.unsupported_claims,
    bannedFound: findBannedConstructions(entry.answer, letterBans(banned)),
    asks: stored.asks,
  };
}

/** One question and its answer on this application. */
function renderAnswered(question: GatheredQuestion): string {
  return `Q: ${question.text}\nA (${question.status ?? 'draft'}): ${question.answer}`;
}

function renderMatch(requirement: GatheredRequirement): string {
  return [
    `- ${requirement.text} (${requirement.verdict})`,
    requirement.evidenceItemId && `  evidence: ${requirement.evidenceItemId}`,
    requirement.why && `  why: ${requirement.why}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export type LetterRequest = {
  material: GatheredMaterial;
  /** The letter drafted last time, to revise rather than start over. */
  previousLetter?: string | null;
  /** Earlier asks; those with a reply are sent as what the person said. */
  asks?: readonly StoredAsk[];
  /** Their vault notes on building with AI, where the letter's observations come from. */
  aiNotes?: readonly VaultPassage[];
};

/**
 * The per-request part of the prompt: what this letter must agree with and
 * lean on, and what the person has said since the last draft. The gathered
 * material goes before it, in the cached prefix.
 */
export function renderLetterRequest(request: LetterRequest): string {
  const { material } = request;
  const answered = answeredQuestions(material.questions);
  const matches = strongestMatches(material.role.requirements);
  const replies = (request.asks ?? []).filter((ask) => ask.reply !== null);
  const previous = request.previousLetter?.trim();
  const aiNotes = request.aiNotes ?? [];

  return [
    answered.length > 0
      ? `## The answers already on this application\n\nThe letter must agree with these and should not retell their stories.\n\n${answered.map(renderAnswered).join('\n\n')}`
      : '## The answers already on this application\n\nNone yet.',
    matches.length > 0
      ? `## Where they match the role best\n\n${matches.map(renderMatch).join('\n')}`
      : '## Where they match the role best\n\nThe requirements have not been matched against their evidence yet; judge the fit from the material.',
    aiNotes.length > 0
      ? `## Their notes on building with AI\n\nThe letter's observations about AI come from here, said the way they said them.\n\n${aiNotes.map(renderVaultPassage).join('\n\n')}`
      : '## Their notes on building with AI\n\nNone found. Take observations only from what the rest of their material says about building with AI, and ask them for one if it holds fewer than two.',
    material.letterComments.length > 0
      ? `## Their comments on the cover letter\n\n${material.letterComments.map((comment) => `- ${comment}`).join('\n')}`
      : null,
    replies.length > 0
      ? `## What they told you when you asked\n\n${replies.map((ask) => `Q: ${ask.question}\nA: ${ask.reply}`).join('\n\n')}`
      : null,
    previous
      ? `## Your previous draft\n\nRevise it with what they told you; keep what still works.\n\n${previous}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}
