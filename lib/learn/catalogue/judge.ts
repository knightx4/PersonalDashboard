import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { NearbySegment } from '@/lib/learn/catalogue/nearest';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Deciding whether a segment actually teaches a claim.
 *
 * The verdict pass docs/LEARN-SOURCES-SPEC.md puts above retrieval. The
 * nearest-neighbour read hands over up to forty candidates and knows nothing
 * about any of them except that their vectors point in a similar direction.
 * This reads the text of each one and has to argue for it in a sentence before
 * a link is written, and the sentence it writes becomes the reading's `why`
 * when the segment is queued.
 *
 * Refusing is the ordinary outcome. A claim the catalogue does not really
 * cover still has forty nearest neighbours, so most of what arrives here
 * should leave without a link. A candidate the model will not argue for is not
 * written at unverified either -- it is not written at all. That is the rule
 * `readings.locator_basis` established: a link that highlights nothing is
 * worse than no link, because you spend the twenty minutes anyway and then
 * stop trusting the queue.
 *
 * Two things the caller can rely on.
 *
 * **A second pass over the same claim costs nothing for the links it already
 * has.** The segments already linked are read first and never reach the model,
 * so the repeat is a single select rather than forty calls. The partial unique
 * indexes on `catalogue_links` are what makes that safe rather than merely
 * likely: two presses racing each other both insert, and the loser is told the
 * pair was already there instead of writing a duplicate.
 *
 * **Nothing here throws.** Every model failure is a candidate that produced no
 * link, counted and reported, and the pass carries on to the next one. One
 * candidate whose reply was cut off should not cost the other thirty-nine.
 */

/** The cheap call, as the rest of the module spells it. */
export const JUDGE_MODEL = 'claude-haiku-4-5';

/** Where the spend lands, for the screen that groups by operation. */
export const JUDGE_OPERATION: LearnOperation = 'judge-segment';

const TOOL_NAME = 'report_verdict';

/**
 * How many judging calls run at once.
 *
 * Somebody is waiting on this press, and forty Haiku calls one after another
 * is most of a minute. Four at a time is the shape of the other batched work
 * in the module: enough that the wait tracks the slowest few rather than the
 * sum, and few enough that a claim with forty candidates does not open forty
 * sockets to be rate-limited on.
 */
export const DEFAULT_JUDGE_CONCURRENCY = 4;

/**
 * As much of a segment as goes into the prompt.
 *
 * A Wikipedia section is the long case and runs to a few thousand words; a
 * transcript window is three to six minutes and is nowhere near this. Past
 * this the segment is too broad to be about one claim, which is the question
 * the feature's own fog is about, and truncating is cheaper than refusing to
 * judge it.
 */
export const MAX_SEGMENT_CHARS = 16_000;

/** What a link points at. Exactly one, matching the check on the table. */
export type LinkTarget = { concept: string; subject?: undefined } | { subject: string; concept?: undefined };

const SYSTEM = `You are given one claim somebody is trying to learn, and one segment
of material -- a section of an article, or a few minutes of a lecture
transcript. Decide whether reading or watching that segment would teach them
that claim.

SAY NO BY DEFAULT. The segment reached you because its wording is statistically
near the claim, which is a much weaker thing than being about it. A segment on
the same broad subject, or one that mentions the claim in passing on its way
somewhere else, is a no. So is a segment that assumes the claim rather than
explaining it.

SAY YES when the segment does the work: states the claim and says why it holds,
derives it, works an example of it, or argues the case for or against it. The
test is whether somebody who did not understand the claim would understand it
afterwards.

WHEN YOU SAY YES, write "basis" as ONE sentence saying what this segment gives
them about this claim. It is shown next to the material and it is the only
reason they will have for opening it, so name the specific thing -- "Derives
the result from the budget constraint and shows where it fails" tells them
something; "Relevant to this claim" does not. No more than about 30 words.
Do not mention similarity, embeddings, or that you were asked to judge.

WHEN YOU SAY NO, put the reason in "reason" in a few words and leave "basis"
null. Nothing is stored either way, so a refusal costs nothing and a wrong yes
costs somebody twenty minutes.`;

/** What one judging call concluded. */
export type JudgeVerdict =
  /** The model read it and argued for it. `basis` is that argument. */
  | { outcome: 'teaches'; basis: string }
  /** The model read it and would not argue for it. The ordinary case. */
  | { outcome: 'refused'; detail: string }
  /** The call did not produce a usable verdict. No link, and no refusal either. */
  | { outcome: 'failed'; detail: string };

/**
 * One judging call, named so a test never reaches a network.
 *
 * The port the two-port pattern asks for, the same as `EmbedClaim` beside it.
 * What a test should hold still is the pass: that a refusal writes nothing,
 * that a link already there is not judged again, that one failure does not
 * take the others with it. None of that is about the Anthropic SDK.
 */
export type SegmentJudge = (input: {
  claim: string;
  /** The concept the claim belongs to, when the caller has it. */
  concept: string | null;
  segment: NearbySegment;
}) => Promise<JudgeVerdict>;

/** One link, as it goes into the table. */
export type JudgedLink = {
  segmentId: string;
  basis: string;
  model: string;
};

/**
 * The two statements this needs against `catalogue_links`.
 *
 * `linked` is what keeps a repeat press cheap and `write` is what keeps it
 * correct; they are separate because they fail differently and because a test
 * wants to answer the first without simulating the second.
 */
export type LinkStore = {
  /** Of these segments, the ones already linked to this target. */
  linked(input: { target: LinkTarget; segmentIds: string[] }): Promise<string[]>;
  /**
   * Write one link at `verified`. False when the pair was already there,
   * which is the unique index answering rather than an error.
   */
  write(input: { target: LinkTarget; link: JudgedLink }): Promise<boolean>;
};

export type JudgePorts = { judge: SegmentJudge; store: LinkStore };

export type JudgePassInput = {
  claim: string;
  concept?: string | null;
  /** The candidates, closest first, as `findNearestSegments` returned them. */
  segments: NearbySegment[];
  target: LinkTarget;
};

export type JudgePassOptions = {
  /** Calls at once. */
  concurrency?: number;
  /** A ceiling on the candidates judged, below whatever retrieval returned. */
  maxCandidates?: number;
};

export type JudgePassResult = {
  /** The links written by this pass, closest candidate first. */
  written: JudgedLink[];
  /** Calls made. What this pass cost, one call each. */
  judged: number;
  /** Candidates the model read and would not argue for. */
  refused: number;
  /** Candidates already linked, which cost no call. */
  skipped: number;
  /** Candidates whose link was already there when the insert ran. */
  raced: number;
  /** Candidates that produced no verdict, with why. */
  failed: { segmentId: string; detail: string }[];
};

/** Run `work` over the inputs, at most `limit` at a time, keeping their order. */
async function inParallel<In, Out>(
  inputs: In[],
  limit: number,
  work: (input: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const results = new Array<Out>(inputs.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, inputs.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= inputs.length) return;
      results[index] = await work(inputs[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Judge the candidates and write the ones that survive.
 *
 * The writes are sequential after the calls rather than interleaved with them:
 * the calls are what takes the time and the inserts are four milliseconds
 * each, and doing them in candidate order means the table reflects the ranking
 * the retrieval pass produced.
 */
export async function judgeCandidates(
  ports: JudgePorts,
  input: JudgePassInput,
  options: JudgePassOptions = {},
): Promise<JudgePassResult> {
  const result: JudgePassResult = {
    written: [],
    judged: 0,
    refused: 0,
    skipped: 0,
    raced: 0,
    failed: [],
  };

  const ceiling = Math.max(0, options.maxCandidates ?? input.segments.length);
  const candidates = input.segments.slice(0, ceiling);
  if (candidates.length === 0) return result;

  const already = new Set(
    await ports.store.linked({
      target: input.target,
      segmentIds: candidates.map((segment) => segment.segmentId),
    }),
  );

  const toJudge = candidates.filter((segment) => !already.has(segment.segmentId));
  result.skipped = candidates.length - toJudge.length;

  const verdicts = await inParallel(
    toJudge,
    options.concurrency ?? DEFAULT_JUDGE_CONCURRENCY,
    (segment) =>
      ports.judge({
        claim: input.claim,
        concept: input.concept ?? null,
        segment,
      }),
  );

  for (const [index, verdict] of verdicts.entries()) {
    const segment = toJudge[index];
    result.judged += 1;

    if (verdict.outcome === 'failed') {
      result.failed.push({ segmentId: segment.segmentId, detail: verdict.detail });
      continue;
    }
    if (verdict.outcome === 'refused') {
      result.refused += 1;
      continue;
    }

    const link: JudgedLink = {
      segmentId: segment.segmentId,
      basis: verdict.basis,
      model: JUDGE_MODEL,
    };

    let stored: boolean;
    try {
      stored = await ports.store.write({ target: input.target, link });
    } catch (error) {
      result.failed.push({
        segmentId: segment.segmentId,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (stored) result.written.push(link);
    else result.raced += 1;
  }

  return result;
}

/** Where a segment sits in its item, for the prompt and for nothing else. */
function whereItIs(segment: NearbySegment): string {
  if (segment.heading) return `Section: ${segment.heading}`;
  if (segment.tStartSeconds !== null) {
    const end = segment.tEndSeconds ?? segment.tStartSeconds;
    return `Transcript, from ${Math.round(segment.tStartSeconds)}s to ${Math.round(end)}s`;
  }
  return `Segment ${segment.ordinal + 1}`;
}

/**
 * The live judge, through Haiku.
 *
 * The similarity is deliberately not in the prompt. It is the reason this
 * candidate was picked and it is not evidence about the question being asked;
 * a model told a segment scored 0.83 will argue for it, which is the whole
 * failure this pass exists to prevent.
 */
export function anthropicJudge(options: {
  apiKey?: string | null;
  client?: Anthropic;
  onSpend?: SpendSink;
}): SegmentJudge {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey ?? undefined });

  return async ({ claim, concept, segment }) => {
    let response;
    try {
      response = await client.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 512,
        system: SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Report whether this segment teaches this claim.',
            input_schema: {
              type: 'object',
              properties: {
                teaches: { type: 'boolean' },
                basis: { type: ['string', 'null'] },
                reason: { type: ['string', 'null'] },
              },
              required: ['teaches'],
            },
          },
        ],
        tool_choice: forceTool(TOOL_NAME),
        messages: [
          {
            role: 'user',
            content: [
              concept ? `Concept: ${concept}` : 'The concept was not named.',
              `The claim: ${claim}`,
              '',
              `From: ${segment.item.title} (${segment.item.kind})`,
              whereItIs(segment),
              '',
              'The segment:',
              segment.text.slice(0, MAX_SEGMENT_CHARS),
              '',
              `Call ${TOOL_NAME}.`,
            ].join('\n'),
          },
        ],
      });
    } catch (error) {
      return {
        outcome: 'failed',
        detail: error instanceof Error ? error.message : 'The judging call failed.',
      };
    }

    // Reported before the reply is judged. A call that came back with a
    // refusal still read the segment and still cost what that cost.
    options.onSpend?.({ model: JUDGE_MODEL, usage: usageFrom(response.usage) });

    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
    if (!block || block.type !== 'tool_use') {
      return { outcome: 'failed', detail: whyNoReport(response) };
    }

    const payload = block.input as { teaches?: unknown; basis?: unknown; reason?: unknown };
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';

    if (payload.teaches !== true) {
      return { outcome: 'refused', detail: reason || 'Near the claim without teaching it.' };
    }

    const basis = typeof payload.basis === 'string' ? payload.basis.trim() : '';
    if (!basis) {
      // `verified` means a model read the segment and argued for it, and there
      // is no argument here. The table would take the row with a made-up
      // basis; this refuses to make one up.
      return { outcome: 'failed', detail: 'Said yes without saying what the segment gives you.' };
    }

    return { outcome: 'teaches', basis: basis.slice(0, 500) };
  };
}

/** Postgres says a unique index refused the row with this. */
const UNIQUE_VIOLATION = '23505';

/**
 * The live store, through the session client.
 *
 * `catalogue_links` is the one catalogue table that belongs to a person, so
 * unlike the rest of this directory it runs as the caller rather than
 * privileged, and RLS is what scopes both statements to their account.
 *
 * The insert does not upsert. PostgREST cannot name the predicate of a partial
 * unique index, so `on_conflict` over these columns has nothing to infer from;
 * and the table has no update policy, which is the schema saying a judged link
 * is written once. A pair that is already there comes back as false.
 */
export function tableLinkStore(supabase: LearnSupabaseClient, userId: string): LinkStore {
  const column = (target: LinkTarget) => (target.concept ? 'concept_id' : 'subject_id');
  const value = (target: LinkTarget) => target.concept ?? target.subject!;

  return {
    async linked({ target, segmentIds }) {
      if (segmentIds.length === 0) return [];

      const { data, error } = await supabase
        .from('catalogue_links')
        .select('segment_id')
        .eq('user_id', userId)
        .eq(column(target), value(target))
        .in('segment_id', segmentIds);

      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => (row as { segment_id: string }).segment_id);
    },

    async write({ target, link }) {
      const { error } = await supabase.from('catalogue_links').insert({
        user_id: userId,
        segment_id: link.segmentId,
        [column(target)]: value(target),
        basis: link.basis,
        confidence: 'verified',
        model: link.model,
      });

      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(error.message);
    },
  };
}

/**
 * Judge the candidates for one claim against the live catalogue.
 *
 * What a server action calls, after `findNearestSegments`. Spending is
 * reported through `onSpend` rather than recorded here, for the reason the
 * retrieval side gives: one press embeds the claim and judges its candidates,
 * and both belong in the ledger in one write at the end.
 */
export async function judgeSegmentsForClaim(
  supabase: LearnSupabaseClient,
  userId: string,
  input: JudgePassInput,
  options: JudgePassOptions & {
    apiKey?: string | null;
    client?: Anthropic;
    onSpend?: SpendSink;
  } = {},
): Promise<JudgePassResult> {
  return judgeCandidates(
    {
      judge: anthropicJudge({
        apiKey: options.apiKey,
        client: options.client,
        onSpend: options.onSpend,
      }),
      store: tableLinkStore(supabase, userId),
    },
    input,
    options,
  );
}
