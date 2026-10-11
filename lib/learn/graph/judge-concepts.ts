import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  isConcreteCost,
  withoutNodes,
  type ChainNode,
  type NoteVerdict,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';
import { NODE_RULE } from '@/lib/learn/graph/position-prompt';
import { MODELS } from '@/lib/core/models';

/**
 * A second look at each concept a note produced (plan #1718).
 *
 * The extractor is asked to apply the node test and leave out what fails it,
 * and it still returns paraphrases of the note and loose facts, because it is
 * reading for concepts and wants to find some. This call reads each one on
 * its own against the same test, in `NODE_RULE`, and sorts it:
 *
 *   keep  passes both halves of the test.
 *   weak  passes them thinly. Still shown for you to approve, and stored with
 *         the mark, so lessons do not spend a slot on it alone (plan #1720).
 *   drop  fails either half. Never shown.
 *
 * It writes its own separating question and cost for every concept it keeps
 * or calls weak, and a concept it cannot write both for is dropped whatever
 * verdict it gave. Those two sentences replace the extractor's: the extractor
 * wrote them to justify its pick, and this call wrote them while deciding
 * whether the pick holds.
 *
 * One call per note, covering every new concept in it, on Haiku under its
 * own model entry. Concepts the subject already holds are not judged:
 * they are in the graph already and the chain only carries them to draw
 * edges.
 *
 * Shaped like lib/learn/catalogue/judge.ts: the call is a port, so the rules
 * that turn verdicts into a chain are tested without a network.
 */

export const CONCEPT_JUDGE_MODEL = MODELS.learnNoteConceptJudge;

const TOOL_NAME = 'report_verdicts';

/** All three verdicts the call can give. Only the first two reach a chain. */
export type ConceptJudgement = NoteVerdict | 'drop';

/** What the call said about one concept, before the rules below check it. */
export type ConceptVerdictReport = {
  name: string;
  verdict: ConceptJudgement;
  separatingQuestion: string | null;
  costIfWrong: string | null;
  reason: string;
};

export type ConceptJudgeResult =
  | { ok: true; verdicts: ConceptVerdictReport[] }
  | { ok: false; detail: string };

/** One judging call over a note's new concepts. */
export type ConceptJudge = (input: {
  subject: string;
  readingTitle: string;
  note: string;
  concepts: ChainNode[];
}) => Promise<ConceptJudgeResult>;

const SYSTEM = `Somebody wrote a note after a reading, and another pass has pulled
concepts out of it for their graph of what they know. Judge each concept on
its own before it is shown to them.

The standard is this, and it is the same one the pass that found them was
given:

${NODE_RULE}

FOR EACH CONCEPT, give one verdict:

  "keep": both tests pass clearly. You can write a question that somebody who
    holds it answers differently from somebody who does not, and being wrong
    about it leads to a specific bad decision, a failed prediction or a wrong
    calculation.
  "weak": both tests pass, but only just. The question is easy to answer
    without really holding the claim, or the cost is real but small or rare.
  "drop": either test fails. A paraphrase of the note's own phrasing, a fact
    about the reading rather than about the world, a subject heading, a claim
    nobody would dispute, or one nothing rests on.

DROP BY DEFAULT WHEN UNSURE between weak and drop. A dropped concept costs
nothing. A weak one still takes a line on the list they approve from.

FOR KEEP AND WEAK, write your own separating_question (one question, ending
in a question mark) and your own cost_if_wrong (one sentence naming what goes
wrong). Write them from the concept, not by copying what you were given.
"It is useful to know" is not a cost. If you cannot write both, the verdict
is "drop".

FOR EVERY CONCEPT, put the reason for the verdict in "reason", in a few words.

Name each concept exactly as it was given to you. Judge every one.`;

/**
 * The live judge, through Haiku.
 *
 * The note goes in so the judge can tell a concept from the note's own
 * phrasing coming back as one. The extractor's question and cost go in too,
 * labelled as the extractor's, so a thin pair reads as thin.
 */
export function anthropicConceptJudge(options: {
  apiKey?: string | null;
  client?: Anthropic;
  onSpend?: SpendSink;
}): ConceptJudge {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey ?? undefined });

  return async ({ subject, readingTitle, note, concepts }) => {
    const lines = [
      `Subject: ${subject}`,
      `They read: ${readingTitle}`,
      '',
      'Their note:',
      note,
      '',
      'The concepts to judge:',
    ];
    for (const concept of concepts) {
      lines.push(
        '',
        `Name: ${concept.name}`,
        `Claim: ${concept.claim}`,
        `The extractor's separating question: ${concept.separatingQuestion ?? '(none)'}`,
        `The extractor's cost if wrong: ${concept.costIfWrong ?? '(none)'}`,
      );
    }
    lines.push('', `Call ${TOOL_NAME} with one verdict for each concept.`);

    let response;
    try {
      response = await client.messages.create({
        model: CONCEPT_JUDGE_MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Report a verdict for each concept.',
            input_schema: {
              type: 'object',
              properties: {
                verdicts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      verdict: { type: 'string', enum: ['keep', 'weak', 'drop'] },
                      separating_question: { type: ['string', 'null'] },
                      cost_if_wrong: { type: ['string', 'null'] },
                      reason: { type: 'string' },
                    },
                    required: ['name', 'verdict', 'reason'],
                  },
                },
              },
              required: ['verdicts'],
            },
          },
        ],
        tool_choice: forceTool(TOOL_NAME, CONCEPT_JUDGE_MODEL),
        messages: [{ role: 'user', content: lines.join('\n') }],
      });
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Checking the concepts failed.',
      };
    }

    // Reported before the reply is read: a reply that cannot be used still
    // cost what it cost.
    options.onSpend?.({ model: CONCEPT_JUDGE_MODEL, usage: usageFrom(response.usage) });

    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
    if (!block || block.type !== 'tool_use') {
      return { ok: false, detail: whyNoReport(response) };
    }

    const raw = (block.input as { verdicts?: unknown }).verdicts;
    if (!Array.isArray(raw)) {
      return { ok: false, detail: 'The check came back without its verdicts.' };
    }

    return { ok: true, verdicts: raw.flatMap(readVerdict) };
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** One reported verdict, or nothing when it is not one of the three. */
function readVerdict(value: unknown): ConceptVerdictReport[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as Record<string, unknown>;
  const name = text(row.name);
  const verdict = row.verdict;
  if (!name || (verdict !== 'keep' && verdict !== 'weak' && verdict !== 'drop')) return [];
  return [
    {
      name,
      verdict,
      separatingQuestion: text(row.separating_question) || null,
      costIfWrong: text(row.cost_if_wrong) || null,
      reason: text(row.reason),
    },
  ];
}

const key = (name: string) => name.trim().toLowerCase();

/** The same floor the extractor's schema puts on a question. */
const MIN_QUESTION_LENGTH = 10;
const MAX_FIELD_LENGTH = 500;

/** Why a judged concept leaves the chain, as the screen's `dropped` list says it. */
export const DROP_REASONS = {
  unjudged: 'the second check said nothing about it',
  judged: 'the second check found nothing to be right or wrong about',
  incomplete: 'the second check could not name both its question and its cost',
  unplaced: 'what it sat under or on top of did not pass the second check',
} as const;

/**
 * Put the verdicts on the chain.
 *
 * Every new node needs a keep or weak verdict with a question and a concrete
 * cost, or it leaves the chain with its reason in `dropped`. A node with no
 * verdict at all is dropped too: the check was asked about it and said
 * nothing, which is not a pass. The ones that stay take the judge's question,
 * cost and verdict. Null when nothing new is left, which the caller reads as a
 * note with nothing in it.
 */
export function applyVerdicts(
  chain: ProposedChain,
  verdicts: readonly ConceptVerdictReport[],
): ProposedChain | null {
  const byName = new Map<string, ConceptVerdictReport>();
  for (const verdict of verdicts) {
    if (!byName.has(key(verdict.name))) byName.set(key(verdict.name), verdict);
  }

  const passed = (verdict: ConceptVerdictReport) => {
    const question = verdict.separatingQuestion ?? '';
    const cost = verdict.costIfWrong ?? '';
    return (
      question.length >= MIN_QUESTION_LENGTH &&
      question.length <= MAX_FIELD_LENGTH &&
      cost.length <= MAX_FIELD_LENGTH &&
      isConcreteCost(cost)
    );
  };

  const { chain: pruned } = withoutNodes(
    chain,
    (node) => {
      const verdict = byName.get(key(node.name));
      if (!verdict) return DROP_REASONS.unjudged;
      if (verdict.verdict === 'drop') {
        return verdict.reason ? `${DROP_REASONS.judged}: ${verdict.reason}` : DROP_REASONS.judged;
      }
      return passed(verdict) ? null : DROP_REASONS.incomplete;
    },
    DROP_REASONS.unplaced,
  );

  const nodes = pruned.nodes.map((node) => {
    if (node.existingId) return node;
    const verdict = byName.get(key(node.name))!;
    return {
      ...node,
      separatingQuestion: verdict.separatingQuestion!,
      costIfWrong: verdict.costIfWrong!,
      verdict: verdict.verdict as NoteVerdict,
    };
  });

  if (!nodes.some((node) => node.existingId === null)) return null;
  return { ...pruned, nodes };
}

export type JudgedNoteResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'nothing-left' | 'error'; detail: string };

/**
 * Judge a note's chain and apply what came back.
 *
 * A failed call is an error rather than a pass. Showing the extractor's list
 * unjudged would let through the concepts this pass exists to drop, and the
 * person can press again.
 */
export async function judgeNoteChain(
  judge: ConceptJudge,
  input: { subject: string; readingTitle: string; note: string; chain: ProposedChain },
): Promise<JudgedNoteResult> {
  const fresh = input.chain.nodes.filter((node) => node.existingId === null);
  if (fresh.length === 0) return { ok: true, chain: input.chain };

  const result = await judge({
    subject: input.subject,
    readingTitle: input.readingTitle,
    note: input.note,
    concepts: fresh,
  });
  if (!result.ok) return { ok: false, reason: 'error', detail: result.detail };

  const chain = applyVerdicts(input.chain, result.verdicts);
  if (!chain) {
    return {
      ok: false,
      reason: 'nothing-left',
      detail: 'Nothing in that note held up as something you could be right or wrong about.',
    };
  }
  return { ok: true, chain };
}
