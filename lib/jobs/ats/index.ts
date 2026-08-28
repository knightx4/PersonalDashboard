import 'server-only';

import { detectPosting, supportsQuestionFetch, type DetectedPosting } from './detect';
import * as greenhouse from './greenhouse';
import * as lever from './lever';
import * as ashby from './ashby';
import * as generic from './generic';
import type { FetchedPosting } from './types';

export { detectPosting, supportsQuestionFetch };
export type { DetectedPosting, FetchedPosting };
export type { FetchedQuestion } from './types';

export type FetchOutcome =
  | { ok: true; posting: FetchedPosting; tier: 1 | 2 }
  | { ok: false; tier: 3; reason: string; detected: DetectedPosting };

/**
 * The only entry point. Nothing outside this directory knows Greenhouse exists,
 * which is also what keeps the paste box honest: it is the documented answer
 * whenever a tier above it fails, rather than an apology.
 */
export async function fetchPostingFromUrl(url: string): Promise<FetchOutcome> {
  const detected = detectPosting(url);

  if (detected.tier === 3) {
    return {
      ok: false,
      tier: 3,
      reason: detected.reason ?? 'That URL cannot be fetched. Paste the description instead.',
      detected,
    };
  }

  try {
    if (detected.vendor === 'greenhouse' && detected.boardToken && detected.jobId) {
      return { ok: true, posting: await greenhouse.fetchPosting(detected.boardToken, detected.jobId), tier: 1 };
    }
    if (detected.vendor === 'lever' && detected.boardToken) {
      return { ok: true, posting: await lever.fetchPosting(detected.boardToken, detected.jobId), tier: 1 };
    }
    if (detected.vendor === 'ashby' && detected.boardToken) {
      return { ok: true, posting: await ashby.fetchPosting(detected.boardToken, detected.jobId), tier: 1 };
    }
    return { ok: true, posting: await generic.fetchPosting(url), tier: 2 };
  } catch (error) {
    // Tier 2 is a fallback for tier 1 as much as for anything else: a board
    // token that 404s on the API often still renders a public page.
    if (detected.tier === 1) {
      try {
        return { ok: true, posting: await generic.fetchPosting(url), tier: 2 };
      } catch {
        // fall through to the paste box
      }
    }
    return {
      ok: false,
      tier: 3,
      reason:
        error instanceof Error
          ? `${error.message} Paste the description instead.`
          : 'That page could not be read. Paste the description instead.',
      detected,
    };
  }
}

/**
 * Application questions, where the vendor serves them. Greenhouse is the only
 * one that does, and saying so plainly is better than a fallback that silently
 * returns nothing.
 */
export async function fetchQuestionsFromUrl(url: string): Promise<
  | { ok: true; questions: FetchedPosting['questions'] }
  | { ok: false; reason: string }
> {
  const detected = detectPosting(url);
  if (!supportsQuestionFetch(detected.vendor) || !detected.boardToken || !detected.jobId) {
    return {
      ok: false,
      reason:
        'Only Greenhouse publishes its application questions. Use the bookmarklet on the application page, or paste the questions in.',
    };
  }
  try {
    const posting = await greenhouse.fetchPosting(detected.boardToken, detected.jobId);
    return { ok: true, questions: posting.questions };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Could not read the application form.',
    };
  }
}
