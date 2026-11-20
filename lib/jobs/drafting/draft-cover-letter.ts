/**
 * A cover letter, drafted from everything on file (plan #2135.1), written by
 * the routine with the cover letter skill.
 *
 * The Draft button no longer calls the API. It queues a request
 * (./letter-request.ts) and fires the goals routine with
 * .claude/skills/cover-letters/SKILL.md, the one cover letter skill, which
 * holds the voice, structure and facts. The routine's session reads what
 * letterPrompt() renders through scripts/cover-letter.ts, writes the letter
 * itself following that skill, and hands its report to
 * keepLetter(), which checks it with the parser the API reply went through.
 *
 * The letter lands beside the editor, not in it: it is kept in
 * job_search.application_drafts (kind cover_letter) so a reload does not
 * lose it, and only the person's Insert and Save put anything in
 * applications.cover_letter.
 *
 * The routine can ask the person things back. Their replies are stored on the
 * same row and rendered into the next prompt, so pressing Redraft uses them.
 */
import 'server-only';

import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import {
  countWords,
  coverLetterView,
  mergeAsks,
  parseCoverLetterPayload,
  renderLetterRequest,
  storedLetter,
  MAX_ASKS,
  type CoverLetterDraftView,
} from './draft-cover-letter-payload';
import { gather, vaultPassages, type GatherDeps, type GatheredMaterial } from './gather';
import { renderMaterial } from './render';
import { LETTER_KEY, loadDrafts, saveDrafts, type StoredAsk } from './store';

/**
 * Asked of their vault for what they have noticed building with AI: a letter
 * to a role about AI draws its AI paragraph from these, and the role's own
 * vault passages rarely reach them.
 */
const AI_NOTES_QUESTION = 'What I have noticed and learned building things with AI, agents and automation';

/**
 * The words a letter may run to: the skill asks for 300 to 400, with room
 * for the greeting and sign-off. A person's comment asking for another
 * length lifts it (`--any-length` on the script).
 */
export const LETTER_WORDS = { min: 250, max: 420 } as const;

/** The shape the routine writes its report in, as the API's tool schema was. */
export const LETTER_TOOL = {
  name: 'report_cover_letter',
  description: 'The cover letter, what it cites, what it could not ground and what to ask them.',
  input_schema: {
    type: 'object',
    properties: {
      letter: {
        type: 'string',
        description: 'The letter itself: the greeting, plain paragraphs and the sign-off. No subject line, date or address block.',
      },
      evidence_item_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Every evidence bank item the letter draws on, copied exactly from its "id:" line.',
      },
      unsupported_claims: {
        type: 'array',
        items: { type: 'string' },
        description: 'Every line not confirmed by the evidence bank, the transcript or their own words, verbatim.',
      },
      asks: {
        type: 'array',
        items: { type: 'string' },
        description: `Up to ${MAX_ASKS} short questions whose answers would make the letter better. Empty when nothing is missing.`,
      },
    },
    required: ['letter', 'evidence_item_ids', 'unsupported_claims', 'asks'],
  },
} as const;

/** What the routine is shown for one letter, and what keepLetter() checks against. */
export type LetterPrompt = {
  material: GatheredMaterial;
  /** The stored asks before this draft, with any replies. */
  earlierAsks: StoredAsk[];
  /** Everything on file, rendered as the API's cached prefix was. */
  materialText: string;
  /** The answers to agree with, the best matches, AI notes, comments, replies and the previous draft. */
  requestText: string;
};

/** Gather and render what the letter is written from. Reads only. */
export async function letterPrompt(
  deps: GatherDeps,
  input: { userId: string; applicationId: string },
): Promise<{ ok: true; prompt: LetterPrompt } | { ok: false; error: string }> {
  const { userId, applicationId } = input;
  const store = deps.jobs as unknown as AppSupabaseClient;

  // gather() checks the application is theirs before anything is read further.
  const gathered = await gather(deps, { userId, applicationId });
  if (!gathered.ok) return { ok: false, error: gathered.error };
  const { material } = gathered;

  const { drafts: previous, error: loadError } = await loadDrafts(store, applicationId, 'cover_letter');
  if (loadError) return { ok: false, error: loadError };
  const earlierAsks = previous?.asks ?? [];
  const aiNotes = await vaultPassages(deps, userId, AI_NOTES_QUESTION);

  return {
    ok: true,
    prompt: {
      material,
      earlierAsks,
      materialText: renderMaterial(material),
      requestText: renderLetterRequest({
        material,
        previousLetter: previous?.drafts[LETTER_KEY]?.answer ?? null,
        asks: earlierAsks,
        aiNotes: aiNotes.passages,
      }),
    },
  };
}

export type DraftCoverLetterResult =
  | { ok: true; draft: CoverLetterDraftView }
  | { ok: false; error: string };

/**
 * Check the routine's report and keep it beside the editor, as the API reply
 * was kept. The row is written only when a letter came back with none of
 * their banned constructions in it.
 */
export async function keepLetter(
  deps: { jobs: GatherDeps['jobs']; newId?: () => string },
  input: {
    userId: string;
    applicationId: string;
    prompt: Pick<LetterPrompt, 'material' | 'earlierAsks'>;
    /** The word range the letter must fall in; null when the person asked for another length. */
    words?: { min: number; max: number } | null;
  },
  report: unknown,
): Promise<DraftCoverLetterResult> {
  const { userId, applicationId, prompt } = input;
  const store = deps.jobs as unknown as AppSupabaseClient;
  const { material, earlierAsks } = prompt;

  const result = parseCoverLetterPayload(
    report,
    material.evidence.items.map((item) => item.id),
    material.style.banned,
  );
  if (!result.ok) return result;
  // A letter carrying a banned construction is not kept: the routine rewrites
  // those lines and saves again, rather than leaving the person to find them.
  if (result.draft.bannedFound.length > 0) {
    return {
      ok: false,
      error: `The letter uses ${result.draft.bannedFound.map((b) => `"${b}"`).join(', ')}, which ${result.draft.bannedFound.length === 1 ? 'is' : 'are'} on their banned list. Rewrite those lines and save again.`,
    };
  }

  const range = input.words === undefined ? LETTER_WORDS : input.words;
  const words = countWords(result.draft.letter);
  if (range && (words < range.min || words > range.max)) {
    return {
      ok: false,
      error: `The letter is ${words} words; it should be ${range.min} to ${range.max}. ${words > range.max ? 'Cut it' : 'Fill it out'} and save again.`,
    };
  }

  const asks = mergeAsks(earlierAsks, result.draft.asks, deps.newId ?? (() => crypto.randomUUID()));
  const row = storedLetter(result.draft, asks);
  const { error: saveError } = await saveDrafts(store, userId, applicationId, 'cover_letter', row);
  if (saveError) return { ok: false, error: saveError };

  const view = coverLetterView(row, material.style.banned);
  if (!view) return { ok: false, error: 'The letter could not be kept.' };
  return { ok: true, draft: view };
}
