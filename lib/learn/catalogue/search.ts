import 'server-only';

import type { SpendReport, SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  judgeSegmentsForClaim,
  type JudgePassOptions,
  type JudgePassResult,
  type LinkTarget,
} from '@/lib/learn/catalogue/judge';
import {
  findNearestSegments,
  type NearbySegment,
  type NearestFailureReason,
  type NearestOptions,
  type NearestOutcome,
} from '@/lib/learn/catalogue/nearest';
import { collectSpend } from '@/lib/learn/spend';

/**
 * What the read button does before it goes to the web.
 *
 * #742's answer: the search runs when you press "Find something to read for
 * this", not when you open a claim and not on a schedule. This is the whole of
 * that press's first pass -- embed the claim, take the near segments, judge
 * them, write the links that survive -- and its one job for the caller is to
 * say whether the catalogue came up with anything. With something, the press
 * stays on the claim and the page lists it. With nothing, the press queues the
 * reading and runs the web search, exactly as it did before this existed.
 *
 * **Every way of coming up empty is the same answer.** A missing embedding
 * key, a provider that timed out, a catalogue with nothing close, forty
 * candidates the judge refused: the person pressed a button asking for
 * something to read, and all of those mean the catalogue cannot give them one.
 * So this never throws and never reports failure as an error -- it reports a
 * miss, with `missed` saying which kind for the logs and for a later screen
 * that wants to tell the cases apart.
 *
 * **Already linked counts as covered.** A repeat press judges nothing, because
 * the pass skips candidates that are already linked, and a press that found
 * the claim covered must still leave you on the claim rather than queueing a
 * second reading of it. So coverage is counted from links present after the
 * pass, not from links this press wrote.
 */

/** Why the catalogue had nothing, when it had nothing. */
export type CatalogueMiss =
  /** Retrieval could not run or would not answer. Carries its own reason. */
  | NearestFailureReason
  /** The judging call cannot run without a key, so nothing was even embedded. */
  | 'no-judge-key'
  /** Nothing in the catalogue was close enough to the claim to be worth a call. */
  | 'nothing-near'
  /** Candidates were read and none was argued for. The ordinary miss. */
  | 'nothing-taught'
  /** The judging pass itself failed, rather than refusing. */
  | 'judge-failed';

export type CatalogueSearchInput = {
  claim: string;
  /** The concept the claim belongs to, named for the judging prompt. */
  concept?: string | null;
  /** What a surviving link is written against. */
  target: LinkTarget;
};

export type CatalogueSearchResult = {
  /** True when the catalogue holds material for this claim after the pass. */
  covered: boolean;
  /** Candidates above the distance floor. Each one that was judged cost a call. */
  considered: number;
  /** Links this press wrote. */
  written: number;
  /** Links that were already there, which cost no call. */
  already: number;
  /** Candidates that produced no verdict. Not refusals. */
  failed: number;
  /** Which kind of nothing, or null when the catalogue covered the claim. */
  missed: CatalogueMiss | null;
  /** What went wrong, when something did. For a log, not for a screen. */
  detail: string | null;
  /** What embedding the claim cost. Recorded by the caller as one operation. */
  embedSpend: SpendReport[];
  /** What the judging calls cost. Recorded by the caller as another. */
  judgeSpend: SpendReport[];
};

/**
 * The two outside calls, named so a test never reaches a network.
 *
 * The same two-port shape the modules below this use. What a test should hold
 * still is the pass's decision -- covered or not, and which kind of nothing --
 * and none of that is about Voyage, Anthropic or PostgREST.
 */
export type CatalogueSearchPorts = {
  retrieve(input: { claim: string; onSpend: SpendSink }): Promise<NearestOutcome>;
  judge(
    input: CatalogueSearchInput & { segments: NearbySegment[]; onSpend: SpendSink },
  ): Promise<JudgePassResult>;
};

/**
 * Search the catalogue for one claim.
 *
 * Never throws, including when the judging pass does: a press that cannot be
 * served by the catalogue has somewhere else to go, and a caller that had to
 * catch as well as check would eventually forget to.
 */
export async function runCatalogueSearch(
  ports: CatalogueSearchPorts,
  input: CatalogueSearchInput,
): Promise<CatalogueSearchResult> {
  const embed = collectSpend();
  const judge = collectSpend();

  const miss = (
    missed: CatalogueMiss,
    detail: string | null,
    counts: { considered?: number; failed?: number } = {},
  ): CatalogueSearchResult => ({
    covered: false,
    considered: counts.considered ?? 0,
    written: 0,
    already: 0,
    failed: counts.failed ?? 0,
    missed,
    detail,
    embedSpend: embed.reports,
    judgeSpend: judge.reports,
  });

  const nearest = await ports.retrieve({ claim: input.claim, onSpend: embed.sink });
  if (!nearest.ok) return miss(nearest.reason, nearest.detail);
  if (nearest.segments.length === 0) return miss('nothing-near', null);

  let pass: JudgePassResult;
  try {
    pass = await ports.judge({
      ...input,
      segments: nearest.segments,
      onSpend: judge.sink,
    });
  } catch (error) {
    return miss('judge-failed', error instanceof Error ? error.message : String(error), {
      considered: nearest.segments.length,
    });
  }

  // `raced` is a link that was written between the skip check and the insert,
  // which is a link that is there now, so it counts the same as `skipped`.
  const already = pass.skipped + pass.raced;
  const covered = pass.written.length + already > 0;

  return {
    covered,
    considered: nearest.segments.length,
    written: pass.written.length,
    already,
    failed: pass.failed.length,
    missed: covered ? null : 'nothing-taught',
    detail: null,
    embedSpend: embed.reports,
    judgeSpend: judge.reports,
  };
}

export type CatalogueSearchOptions = NearestOptions &
  JudgePassOptions & {
    /** Falls back to ANTHROPIC_API_KEY. Null is a miss rather than an error. */
    anthropicApiKey?: string | null;
    /** Falls back to EMBEDDING_API_KEY, inside the embedding call. */
    embeddingApiKey?: string | null;
  };

/**
 * Search the live catalogue for one claim.
 *
 * What the server action calls. The Anthropic key is checked before anything
 * is embedded: without it every candidate would fail to be judged, and paying
 * for the embedding to find that out is a cost with no outcome.
 */
export async function searchCatalogueForClaim(
  supabase: LearnSupabaseClient,
  userId: string,
  input: CatalogueSearchInput,
  options: CatalogueSearchOptions = {},
): Promise<CatalogueSearchResult> {
  const anthropicApiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!anthropicApiKey) {
    return {
      covered: false,
      considered: 0,
      written: 0,
      already: 0,
      failed: 0,
      missed: 'no-judge-key',
      detail: 'ANTHROPIC_API_KEY is not set on this deployment',
      embedSpend: [],
      judgeSpend: [],
    };
  }

  return runCatalogueSearch(
    {
      retrieve: ({ claim, onSpend }) =>
        findNearestSegments(supabase, claim, {
          ...options,
          apiKey: options.embeddingApiKey,
          onSpend,
        }),
      judge: ({ claim, concept, segments, target, onSpend }) =>
        judgeSegmentsForClaim(
          supabase,
          userId,
          { claim, concept, segments, target },
          { ...options, apiKey: anthropicApiKey, onSpend },
        ),
    },
    input,
  );
}
