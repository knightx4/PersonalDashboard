/**
 * Shape and validation for a drafted answer, plus the post-checks that run on
 * it. Kept free of server-only imports so the rules can be tested directly.
 *
 * Two things are checked here, and both are checks rather than instructions:
 *
 * The citations, because a claim the model could not ground is the thing this
 * whole layer exists to surface. An id it invented is not evidence.
 *
 * The banned constructions, because an instruction not to use a phrase leaks —
 * the model reads "do not say passionate about" and writes around it for two
 * sentences before drifting back. A regex over the output does not drift.
 */
import { z } from 'zod';

export interface AnswerDraft {
  text: string;
  /** Evidence actually cited, filtered to what was offered. */
  evidenceItemIds: string[];
  /** Claims the model itself flagged as not grounded in an item. */
  unsupportedClaims: string[];
  /** Banned constructions found in the text, as written. */
  bannedFound: string[];
}

export type DraftResult = { ok: true; draft: AnswerDraft } | { ok: false; error: string };

const draftSchema = z.object({
  answer: z.string().trim().min(1),
  evidence_item_ids: z.array(z.string()).nullish(),
  unsupported_claims: z.array(z.string().trim().min(1)).nullish(),
});

/**
 * Which banned constructions appear in the text.
 *
 * Matched case-insensitively on a word boundary, so "passionate about" catches
 * "Passionate about" and not "dispassionate". A construction that is bare
 * punctuation — an em dash, say — has no word boundary to anchor to, so it is
 * matched literally.
 */
export function findBannedConstructions(
  text: string,
  banned: readonly string[],
): string[] {
  const found: string[] = [];
  for (const raw of banned) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordish = /^[\p{L}\p{N}]/u.test(phrase) && /[\p{L}\p{N}]$/u.test(phrase);
    const pattern = wordish ? new RegExp(`\\b${escaped}\\b`, 'iu') : new RegExp(escaped, 'iu');
    if (pattern.test(text) && !found.includes(phrase)) found.push(phrase);
  }
  return found;
}

/**
 * The default list, seeded into a profile that has none.
 *
 * Em dashes and "passionate about" are here because they are the two tells
 * that a paragraph was not written by the person sending it.
 */
export const DEFAULT_BANNED_CONSTRUCTIONS = [
  '—',
  'passionate about',
  'delve',
  'leverage',
  'synergy',
  'in today’s fast-paced',
  'I am excited about the opportunity',
];

/** Validate a drafted answer against the evidence that was actually offered. */
export function parseDraftPayload(
  raw: unknown,
  offeredIds: readonly string[],
  banned: readonly string[],
): DraftResult {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The draft came back in an unexpected shape.' };
  }

  const allowed = new Set(offeredIds);
  const cited = [...new Set(parsed.data.evidence_item_ids ?? [])].filter((id) => allowed.has(id));
  const invented = (parsed.data.evidence_item_ids ?? []).filter((id) => !allowed.has(id)).length;

  // Generation with an empty evidence set is an error, not an empty-context
  // fallback, and a draft that cites nothing is that error arriving late.
  if (cited.length === 0) {
    return {
      ok: false,
      error: invented
        ? 'The draft cited evidence that does not exist, so it was discarded.'
        : 'The draft grounded nothing in your bank, so it was discarded.',
    };
  }

  const unsupported = [...new Set(parsed.data.unsupported_claims ?? [])];

  return {
    ok: true,
    draft: {
      text: parsed.data.answer,
      evidenceItemIds: cited,
      // An id it made up is a claim it could not ground, whatever it said in
      // the other array — it is surfaced rather than quietly dropped.
      unsupportedClaims: invented
        ? [...unsupported, 'Part of this cited an evidence item that does not exist.']
        : unsupported,
      bannedFound: findBannedConstructions(parsed.data.answer, banned),
    },
  };
}
