import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadConcept } from '@/lib/learn/graph/load';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { nextMasteryCheck, recordProbe } from '@/lib/learn/graph/session';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { writeSurveyIdea } from './idea';
import { loadSurveyPool, loadUnaskedSurveyIdea } from './load';
import { SURVEY_TRIES, surveyCandidates, type SurveyCandidate, type SurveyPool } from './pick';

/**
 * Write one survey question about a vault theme you have no track for
 * (plan #841).
 *
 * The theme is chosen by `surveyCandidates`, which spreads questions across
 * fields and prefers a field where nothing has been answered. The question is
 * about one idea from your notes on the theme (`writeSurveyIdea`), and is
 * written and stored the way Practice Flow writes its own: `writeProbe`, then
 * `recordProbe`. So `recordAnswer` grades it with no change, and the idea's
 * state moves like any other.
 *
 * A theme that cannot be asked about (no notes, no claim in them, a question
 * that did not survive its own check) hands over to the next candidate, up to
 * `SURVEY_TRIES` themes a call.
 */

/** What the flow shows for a survey question. */
export type SurveyQuestion = {
  probeId: string;
  conceptId: string;
  conceptName: string;
  /** The theme's hidden survey subject. Not one of your tracks. */
  subjectId: string;
  themeId: string;
  /** The subject the question is about, as the vault names it. */
  themeName: string;
  fieldId: string;
  fieldName: string;
  question: string;
  options: string[];
};

export type WrittenSurveyQuestion =
  | { ok: true; question: SurveyQuestion }
  | {
      ok: false;
      /** `nothing`: no theme left to ask about. `error`: every theme tried failed. */
      reason: 'nothing' | 'error';
      detail: string;
    };

type Idea = {
  subjectId: string;
  conceptId: string;
  name: string;
  claim: string;
  mastery: string[];
};

export async function writeSurveyQuestion(input: {
  supabase: LearnSupabaseClient;
  vault: VaultSupabaseClient;
  userId: string;
  anthropicApiKey: string;
  /**
   * Set to store the question as one of Practice Flow's: `shownAt` is now for
   * a question somebody is waiting on and null for one written ahead. Left
   * out, it is stored as a plain question with no pick recorded.
   */
  flow?: { shownAt: string | null };
  /** Themes not to try, such as ones that already failed in this request. */
  skip?: ReadonlySet<string>;
  /** Already loaded, to save reading it again. */
  pool?: SurveyPool;
  client?: Anthropic;
  /** The idea's model call. Record it as 'write-survey-idea'. */
  onIdeaSpend?: SpendSink;
  /** The question's model call. Record it as 'write-survey-question'. */
  onSpend?: SpendSink;
}): Promise<WrittenSurveyQuestion> {
  const pool = input.pool ?? (await loadSurveyPool(input.supabase, input.vault));
  const candidates = surveyCandidates(pool, SURVEY_TRIES, input.skip);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'nothing',
      detail: 'Every subject you write about is a track already, or has no notes linked to it.',
    };
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    const written = await writeFor(input, candidate);
    if (written.ok) return written;
    failures.push(`${candidate.themeName}: ${written.detail}`);
  }
  return { ok: false, reason: 'error', detail: failures.join(' ') };
}

async function ideaFor(
  input: Parameters<typeof writeSurveyQuestion>[0],
  themeId: string,
): Promise<{ ok: true; idea: Idea } | { ok: false; detail: string }> {
  const unasked = await loadUnaskedSurveyIdea(input.supabase, themeId);
  if (unasked) return { ok: true, idea: unasked };

  const written = await writeSurveyIdea({
    supabase: input.supabase,
    vault: input.vault,
    userId: input.userId,
    themeId,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onIdeaSpend,
  });
  if (!written.ok) return { ok: false, detail: written.detail };
  return {
    ok: true,
    idea: {
      subjectId: written.subjectId,
      conceptId: written.conceptId,
      name: written.idea.name,
      claim: written.idea.claim,
      mastery: written.idea.mastery ?? [],
    },
  };
}

async function writeFor(
  input: Parameters<typeof writeSurveyQuestion>[0],
  candidate: SurveyCandidate,
): Promise<{ ok: true; question: SurveyQuestion } | { ok: false; detail: string }> {
  const found = await ideaFor(input, candidate.themeId);
  if (!found.ok) return found;
  const { idea } = found;

  // A new idea has had nothing asked about it, so this is its first check.
  const check = nextMasteryCheck(idea.mastery, []);
  const result = await writeProbe({
    concept: idea.name,
    claim: idea.claim,
    check,
    otherChecks: idea.mastery.filter((other) => other !== check),
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  // The idea stays, unasked, and the next pick of this theme uses it.
  if (!result.ok) return { ok: false, detail: result.detail };

  let flow;
  if (input.flow) {
    const concept = await loadConcept(input.supabase, idea.conceptId);
    flow = {
      pickedState: concept?.state ?? 'unknown',
      pickedRecheck: null,
      shownAt: input.flow.shownAt,
    };
  }
  const probeId = await recordProbe(input.supabase, input.userId, {
    conceptId: idea.conceptId,
    probe: result.probe,
    model: PROBE_MODEL,
    flow,
  });

  return {
    ok: true,
    question: {
      probeId,
      conceptId: idea.conceptId,
      conceptName: idea.name,
      subjectId: idea.subjectId,
      themeId: candidate.themeId,
      themeName: candidate.themeName,
      fieldId: candidate.fieldId,
      fieldName: candidate.fieldName,
      question: result.probe.question,
      options: result.probe.options,
    },
  };
}
