import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import type { SpendReport, SpendSink } from '@/lib/core/spend/pricing';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  JUDGE_MODEL,
  judgeSegmentsForClaim,
  type Judgement,
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
  | 'judge-failed'
  /**
   * Nothing has been embedded since this claim was last searched, so no call
   * was made and the answer from last time stands. Not a search, which is why
   * `searchCompleted` refuses it: a press that looked at nothing must not move
   * the claim's search time.
   */
  | 'nothing-new';

export type CatalogueSearchInput = {
  claim: string;
  /** The concept the claim belongs to, named for the judging prompt. */
  concept?: string | null;
  /** What a surviving link is written against. */
  target: LinkTarget;
  /**
   * When the button was pressed. Every judgement the press records carries
   * it, so one press reads back as one group. Defaults to the start of the pass.
   */
  pressedAt?: Date;
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
  /** Keep what the judge said about each candidate it read. */
  record(input: {
    target: LinkTarget;
    judgements: Judgement[];
    pressedAt: Date;
  }): Promise<void>;
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
  const pressedAt = input.pressedAt ?? new Date();

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

  // Every call the pass made, refusals and failures with the acceptances, so
  // the trial can read what the judge did with each candidate. A write that
  // fails is logged and the press goes on: the person is owed their answer
  // more than the trial is owed its row.
  if (pass.judgements.length > 0) {
    try {
      await ports.record({ target: input.target, judgements: pass.judgements, pressedAt });
    } catch (error) {
      console.warn(
        '[learn catalogue] recording the judgements failed',
        error instanceof Error ? error.message : String(error),
      );
    }
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
      record: (recorded) => recordJudgements(supabase, userId, recorded),
    },
    input,
  );
}

/**
 * Write one row per judged candidate to `catalogue_judgements`.
 *
 * One insert for the whole press. Throws on failure; the pass above catches it,
 * because a lost row costs the trial a data point and a thrown press costs the
 * person their answer.
 */
export async function recordJudgements(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { target: LinkTarget; judgements: Judgement[]; pressedAt: Date },
): Promise<void> {
  if (input.judgements.length === 0) return;

  const pressedAt = input.pressedAt.toISOString();
  const target = input.target.concept
    ? { concept_id: input.target.concept }
    : { subject_id: input.target.subject };

  const { error } = await supabase.from('catalogue_judgements').insert(
    input.judgements.map((judgement) => ({
      user_id: userId,
      segment_id: judgement.segmentId,
      ...target,
      similarity: judgement.similarity,
      chars: judgement.chars,
      verdict: judgement.verdict,
      model: JUDGE_MODEL,
      pressed_at: pressedAt,
    })),
  );

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(error.message);
}

/**
 * Whether the press got an answer out of the catalogue.
 *
 * What separates a claim nobody has looked for material for from a claim that
 * was looked for and had none. Both end with no links, so the difference is
 * not readable off `catalogue_links` and has to be recorded by the press that
 * knows.
 *
 * `nothing-near` and `nothing-taught` are searches. The claim was embedded,
 * the index answered, and either nothing was close enough to be worth a call
 * or every candidate was read and refused. An empty answer is still an answer
 * and the claim page may say so.
 *
 * Everything else is a press that never reached that point. Without a key
 * nothing was embedded; a provider that would not answer retrieved nothing;
 * `judge-failed` retrieved candidates and formed no verdict about any of them.
 * `nothing-new` did not look at all, because nothing had arrived since the
 * last press; the time that press wrote is the one that still holds.
 * Recording one of those would have the page say nothing matched when nothing
 * was read, and would have the repeat press treat a timeout as a search
 * already done, which is a claim that never gets searched again.
 */
export function searchCompleted(missed: CatalogueMiss | null): boolean {
  return missed === null || missed === 'nothing-near' || missed === 'nothing-taught';
}

/**
 * Write the time a claim was last searched.
 *
 * A call of its own rather than part of the pass, so the press decides whether
 * the search counted and a caller that wants to search again can wrap the pass
 * without touching it.
 *
 * False rather than a throw when the write fails. The person pressed a button
 * asking for something to read and has their answer by now; a claim left
 * reading as never searched costs them one more press, and an error page costs
 * them the answer. The caller logs it.
 */
export async function recordClaimSearched(
  supabase: LearnSupabaseClient,
  userId: string,
  conceptId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const { error } = await supabase
    .from('concepts')
    .update({ catalogue_searched_at: at.toISOString() })
    .eq('user_id', userId)
    .eq('id', conceptId);

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) {
    console.warn('[learn catalogue] recording the search time failed', error.message);
    return false;
  }

  return true;
}

/**
 * A press, including the presses that decided not to search.
 *
 * `skipped` is what the caller cannot work out from the rest: a skip that
 * finds the claim already covered is indistinguishable from a search that
 * judged nothing new and found the same links, and only one of those looked.
 */
export type CatalogueSearchOutcome = CatalogueSearchResult & {
  /** True when no call was made because nothing has arrived since last time. */
  skipped: boolean;
};

/**
 * The three things the repeat press asks, named so a test never reaches a
 * database.
 *
 * `search` is the whole of the pass below this, handed over as a port rather
 * than called directly, which is what lets a test prove that a skipped press
 * judged nothing: the port is simply never reached.
 */
export type RepeatPressPorts = {
  /** Whether any segment has been embedded since the given moment. */
  embeddedSince(at: string): Promise<boolean>;
  /** Whether the claim already holds links, which is what a skip shows. */
  linked(): Promise<boolean>;
  /** The pass, run only when there is something new to run it against. */
  search(): Promise<CatalogueSearchResult>;
};

/**
 * Search the catalogue for one claim, unless nothing has arrived since the
 * last time it was searched.
 *
 * #743's answer. The retrieval call is cents and the judging calls are the
 * cost that grows with the catalogue, so the press that can skip both is worth
 * the two selects it takes to find out. A claim nobody has pressed the button
 * on has no search time and searches, which is every claim in this database
 * today.
 *
 * **What counts as arrived is a segment that has been embedded**, not one that
 * has been fetched. A segment with no vector cannot be retrieved, so searching
 * for its sake would cost the calls and find it no sooner; the embedding sweep
 * stamps `embedded_at` and the next press picks it up. That also covers a
 * section rewritten in place, because the re-sweep drops the stale vector and
 * the new one is stamped when it lands.
 *
 * **A skip shows what is stored rather than nothing.** The links are still
 * there, so a claim the catalogue covered last time comes back covered and the
 * press stays on the claim. A claim that was searched and had nothing comes
 * back a miss, and the press queues the reading and goes to the web, which is
 * what the press before it did.
 */
export async function runCatalogueSearchIfNew(
  ports: RepeatPressPorts,
  searchedAt: string | null,
): Promise<CatalogueSearchOutcome> {
  if (searchedAt === null || (await ports.embeddedSince(searchedAt))) {
    return { ...(await ports.search()), skipped: false };
  }

  const covered = await ports.linked();

  return {
    covered,
    considered: 0,
    written: 0,
    already: 0,
    failed: 0,
    missed: covered ? null : 'nothing-new',
    detail: null,
    embedSpend: [],
    judgeSpend: [],
    skipped: true,
  };
}

export type RepeatPressOptions = CatalogueSearchOptions & {
  /** When this claim was last searched, off the concept. Null: never. */
  searchedAt: string | null;
};

/**
 * Whether anything has been embedded since a moment.
 *
 * True when the read fails, which sends the press to search. The alternative
 * is a failed select deciding that nothing has arrived, and a person who
 * pressed a button for something to read being shown last week's answer
 * because PostgREST was unhappy.
 */
async function anyEmbeddedSince(supabase: LearnSupabaseClient, at: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('catalogue_segments')
    .select('id')
    .gt('embedded_at', at)
    .limit(1)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) {
    console.warn('[learn catalogue] reading what is new failed', error.message);
    return true;
  }

  return data !== null;
}

/**
 * Whether this claim holds any link at all.
 *
 * Asked only of a press that is skipping, to tell a claim the catalogue
 * covered from one it was searched for and had nothing. A count would read the
 * same rows; one id is all the answer needs.
 */
async function anyLinkFor(
  supabase: LearnSupabaseClient,
  userId: string,
  target: LinkTarget,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('catalogue_links')
    .select('id')
    .eq('user_id', userId)
    .eq(target.concept ? 'concept_id' : 'subject_id', target.concept ?? target.subject)
    .limit(1)
    .maybeSingle();

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) {
    console.warn('[learn catalogue] reading what is already linked failed', error.message);
    return false;
  }

  return data !== null;
}

/**
 * Search the live catalogue for one claim, unless nothing is new.
 *
 * What the server action calls. It wraps `searchCatalogueForClaim` rather than
 * changing it: the pass has one job and this has the other, and a caller that
 * wants the search whatever the state of the catalogue still has it.
 */
export async function searchCatalogueIfNew(
  supabase: LearnSupabaseClient,
  userId: string,
  input: CatalogueSearchInput,
  options: RepeatPressOptions,
): Promise<CatalogueSearchOutcome> {
  return runCatalogueSearchIfNew(
    {
      embeddedSince: (at) => anyEmbeddedSince(supabase, at),
      linked: () => anyLinkFor(supabase, userId, input.target),
      search: () => searchCatalogueForClaim(supabase, userId, input, options),
    },
    options.searchedAt,
  );
}
