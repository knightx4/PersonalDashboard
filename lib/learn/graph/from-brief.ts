import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  approvedChainSchemaWith,
  chainPayloadSchema,
  normaliseChain,
  whyMalformed,
  placeMentions,
  wouldCycle,
  MAX_CHAIN,
  type ChainEdge,
  type ChainMention,
  type ChainNode,
  type ExistingConcept,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';

/**
 * A briefing somebody wrote for you, read into things you have yet to learn.
 *
 * The same call as from-prior.ts with the stance reversed. Prior learning is
 * an account of what you already hold, so its nodes are declared known on
 * approval; a briefing is a stack of claims somebody else is making at you,
 * and the question the model is asked is "what would a reader have to
 * understand to follow this". The nodes stay unknown, which is the only reason
 * any of it can be tracked, probed or ordered afterwards.
 *
 * #145 settled how a briefing bigger than one chain is handled: split it on
 * its own headings, run one pass per section into the same subject, and dedupe
 * across the passes in order. A paste with no headings is one pass, which is
 * the old behaviour and the cheap case. What no pass could place comes back
 * named rather than dropped in silence.
 *
 * #149 settled the second relation this call reports: where one claim talks
 * about another without depending on it, that is a mention and it is stored,
 * with its own sentence saying where the briefing made the connection. It is
 * the one thing here that never reaches the pruning walk or the learning
 * order.
 *
 * Nothing here writes. What it returns is a proposal, and it stays a proposal
 * until somebody ticks the rows.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_chain';

/** Passes per import. Eight tokens plus the market is the shape to cover; at
 * roughly $0.05 a pass, ten is the point where the cost stops being small. */
export const MAX_BRIEF_SECTIONS = 10;

/** Nodes an import can propose in total, across every pass. */
export const MAX_BRIEF_NODES = 40;

/** Characters per pass when the briefing has no headings to split on. */
const SECTION_CHARS = 6000;

/** The longest paste an import will read: every pass, filled. */
export const MAX_BRIEFING_CHARS = MAX_BRIEF_SECTIONS * SECTION_CHARS;

/**
 * The shape an import's proposal rides back in from the form.
 *
 * `approvedChainSchema` caps a chain at 20 nodes, which is where one call to
 * the model is capped. Ten passes can propose forty between them, so the same
 * shape is rebuilt at this import's own caps. The dropped list is the loose
 * one: every pass can leave a whole chain's worth of rows behind, and a
 * proposal refused for carrying too many of them would be refused for being
 * too honest.
 */
export const approvedBriefSchema = approvedChainSchemaWith({
  nodes: MAX_BRIEF_NODES,
  edges: MAX_BRIEF_NODES * 2,
  mentions: MAX_BRIEF_NODES * 2,
  dropped: MAX_BRIEF_SECTIONS * MAX_CHAIN * 2 + MAX_BRIEF_NODES,
});

const SYSTEM = `Somebody has been handed a prepared briefing and wants it turned into things
they can learn. You are reading one section of it.

THESE ARE CLAIMS THEY DO NOT HOLD YET. You are not recording what the reader
knows. You are recording what this section says, so that each piece of it can
be learned, probed and checked later. Nothing you report is known, established
or verified by anybody.

CLAIMS, NOT HEADINGS. Every node is one thing a person can be right or wrong
about, stated in a sentence or two.

  Heading, useless: "Ethereum Classic."
  Claim, usable: "Ethereum Classic kept the original chain after the DAO fork,
  so its security budget is a fraction of the chain that carried the name."

A LOOSE FACT IS NOT A CLAIM YOU CAN PLACE. A revenue figure, a founding date,
a headcount -- nothing rests on it and it rests on nothing, so it has no place
in a graph of what has to be understood first. Skip it. Report the claim it is
evidence for, when the section makes one.

FEW, AND THE ONES THAT CARRY THE SECTION. One to eight, never more than
${MAX_CHAIN}. The claims the section is actually built on, not every sentence
in it.

EDGES. Join them to each other where one rests on the other, and to the
concepts the subject already holds -- you are given those by name. Nothing goes
in the graph without an edge.

DO NOT REPROPOSE what the subject already has. Name it exactly as given and
draw the edge instead.

MENTIONS, WHICH ARE NOT EDGES. When one claim talks about another -- names it,
compares itself to it, is argued against it -- report that as a mention rather
than an edge. An edge says you cannot understand this without that first; a
mention says this one brings the other one up. Two claims may mention each
other, and often do. Report a mention only where the section actually makes the
connection, and say where, in the same one short sentence a basis takes.

${MASTERY_RULE}

${KIND_RULE}

BASIS, HONESTLY. Each node and edge carries one short sentence on how you know
it belongs, and it is shown to the reader. Here that sentence says where in the
briefing it came from -- "the briefing's section on the market states this
outright", "the section argues this from the fee history it quotes". It must
never read as though the claim was checked against anything. The briefing said
it; that is the whole of what you know.

SUBJECT. Name the subject this belongs in -- something one survey course could
cover. Prefer the one you were given if the section genuinely sits inside it.

IF THE SECTION STATES NO CLAIMS -- it is a table of numbers, a contents page, a
list of names -- set too_vague true and propose nothing.`;

export type FromBriefResult =
  | { ok: true; chain: ProposedChain }
  | { ok: false; reason: 'nothing-in-it' | 'error'; detail: string };

/** One pass's worth of the briefing, and what to call it when it fails. */
export type BriefSection = { title: string; text: string };

const NOTHING_IN_IT =
  'Nothing in that states a claim this subject does not already have. A briefing this can read argues things — what something is, why it works, what follows from it — rather than listing names and numbers.';

const key = (name: string) => name.trim().toLowerCase();

const ATX_HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/** The first line of a block, short enough to name it on a screen. */
function label(text: string): string {
  const first =
    text
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? 'that section';
  const bare = first.replace(ATX_HEADING, '$2');
  return bare.length > 80 ? `${bare.slice(0, 77)}…` : bare;
}

/**
 * Cut the briefing into the pieces each pass reads.
 *
 * Its own headings first, because a briefing written a pass per token already
 * says where one ends. Failing that, blank-line blocks grouped up to a size --
 * a paragraph is too small to be worth a call of its own, and a pass per
 * paragraph is how a cheap import becomes an expensive one.
 */
export function splitBriefing(briefing: string): BriefSection[] {
  const headed: BriefSection[] = [];
  let current: string[] | null = null;

  for (const line of briefing.split(/\r?\n/)) {
    if (ATX_HEADING.test(line)) {
      if (current) headed.push({ title: label(current.join('\n')), text: current.join('\n') });
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) headed.push({ title: label(current.join('\n')), text: current.join('\n') });

  // A heading with nothing under it is a contents line, not a section, and a
  // single heading over the whole paste says nothing about where to cut.
  const withBody = headed.filter(
    (section) => section.text.replace(ATX_HEADING, '').trim().length > 0,
  );
  if (withBody.length > 1) return withBody;

  const blocks = briefing
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const sections: BriefSection[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join('\n\n');
    sections.push({ title: label(text), text });
    buffer = [];
    size = 0;
  };

  for (const block of blocks) {
    if (size > 0 && size + block.length > SECTION_CHARS) flush();
    buffer.push(block);
    size += block.length;
  }
  flush();

  return sections;
}

type Pass =
  | { kind: 'chain'; chain: ProposedChain }
  | { kind: 'nothing' }
  | { kind: 'error'; detail: string };

async function readSection(input: {
  client: Anthropic;
  subject: string | null;
  section: BriefSection;
  known: string[];
  existing: ExistingConcept[];
  onSpend?: SpendSink;
}): Promise<Pass> {
  const lines = input.subject ? [`Subject: ${input.subject}`, ''] : [];
  lines.push('A section of the briefing they were handed:', input.section.text);

  if (input.known.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds — name these exactly as written rather than restating them:',
      ...input.known.map((name) => `- ${name}`),
    );
  }
  lines.push(
    '',
    `Call ${TOOL_NAME}, with goal_concept set to whichever concept this section is most about.`,
  );

  let response;
  try {
    response = await input.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the claims this section of the briefing makes.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              goal_concept: { type: 'string' },
              too_vague: { type: 'boolean' },
              concepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    claim: { type: 'string' },
                    basis: { type: 'string' },
                    mastery: MASTERY_TOOL_FIELD,
                    kind: KIND_TOOL_FIELD,
                  },
                  required: ['name', 'claim', 'basis', 'mastery', 'kind'],
                },
              },
              edges: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prerequisite: { type: 'string' },
                    dependent: { type: 'string' },
                    basis: { type: 'string' },
                  },
                  required: ['prerequisite', 'dependent', 'basis'],
                },
              },
              mentions: {
                type: 'array',
                description:
                  'One claim that talks about another without depending on it. Both directions between the same pair are allowed.',
                items: {
                  type: 'object',
                  properties: {
                    source: { type: 'string' },
                    target: { type: 'string' },
                    basis: { type: 'string' },
                  },
                  required: ['source', 'target', 'basis'],
                },
              },
            },
            required: ['subject', 'goal_concept', 'concepts', 'edges'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      kind: 'error',
      detail: error instanceof Error ? error.message : 'Reading that briefing failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { kind: 'error', detail: whyNoReport(response) };
  }

  const safe = chainPayloadSchema.safeParse(block.input);
  if (!safe.success) return { kind: 'error', detail: whyMalformed(safe.error) };

  const chain = normaliseChain(safe.data, input.existing);
  return chain ? { kind: 'chain', chain } : { kind: 'nothing' };
}

export async function conceptsFromBrief(input: {
  /** The subject to place this in, when there is one. Null lets it name one. */
  subject: string | null;
  /** The briefing, as it was pasted. */
  briefing: string;
  existing: ExistingConcept[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FromBriefResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const sections = splitBriefing(input.briefing);
  if (sections.length === 0) return { ok: false, reason: 'nothing-in-it', detail: NOTHING_IN_IT };

  const dropped: { name: string; reason: string }[] = [];
  for (const over of sections.slice(MAX_BRIEF_SECTIONS)) {
    dropped.push({
      name: over.title,
      reason: `not read: an import stops after ${MAX_BRIEF_SECTIONS} sections`,
    });
  }

  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  const mentions: ChainMention[] = [];
  const proposed = new Set<string>();

  let subject = input.subject;
  let goalConcept: string | null = null;
  let joined = 0;
  let failure: string | null = null;
  let full = false;

  for (const section of sections.slice(0, MAX_BRIEF_SECTIONS)) {
    if (full) {
      dropped.push({
        name: section.title,
        reason: `not read: an import stops at ${MAX_BRIEF_NODES} concepts`,
      });
      continue;
    }

    const pass = await readSection({
      client,
      subject,
      section,
      // Everything earlier passes proposed goes in by name, so a later one
      // draws an edge to it instead of proposing it a second time.
      known: [...input.existing.map((concept) => concept.name), ...nodes.map((node) => node.name)],
      existing: input.existing,
      onSpend: input.onSpend,
    });

    if (pass.kind === 'error') {
      failure ??= pass.detail;
      dropped.push({ name: section.title, reason: `could not be read: ${pass.detail}` });
      continue;
    }
    if (pass.kind === 'nothing') {
      dropped.push({
        name: section.title,
        reason: 'no claim in it that this subject does not already have',
      });
      continue;
    }

    // The first pass that gets anywhere fixes the subject; the rest are told
    // it, so eight passes land in one graph rather than eight.
    subject ??= pass.chain.subject;
    goalConcept ??= pass.chain.goalConcept;
    joined += pass.chain.joined;
    dropped.push(...pass.chain.dropped);

    for (const node of pass.chain.nodes) {
      if (proposed.has(key(node.name))) continue;
      if (!node.existingId && nodes.filter((n) => !n.existingId).length >= MAX_BRIEF_NODES) {
        full = true;
        dropped.push({
          name: node.name,
          reason: `not added: an import stops at ${MAX_BRIEF_NODES} concepts`,
        });
        continue;
      }
      proposed.add(key(node.name));
      nodes.push(node);
    }

    for (const edge of pass.chain.edges) {
      if (!proposed.has(key(edge.prerequisite)) || !proposed.has(key(edge.dependent))) continue;
      if (
        edges.some(
          (e) =>
            key(e.prerequisite) === key(edge.prerequisite) &&
            key(e.dependent) === key(edge.dependent),
        )
      ) {
        continue;
      }
      // Each pass is acyclic on its own; two of them together need not be, and
      // the database refuses the whole write rather than the one edge.
      if (wouldCycle(edges, edge)) {
        dropped.push({
          name: `${edge.prerequisite} → ${edge.dependent}`,
          reason: 'would close a loop with an earlier section',
        });
        continue;
      }
      edges.push(edge);
    }

    // Each pass has already placed its own against its own nodes. They are
    // placed once more at the end, against everything that survived: two
    // sections can report the same pair, and one can report as a mention what
    // another draws as an edge, and neither is visible from inside a pass.
    mentions.push(...pass.chain.mentions);
  }

  // A node can lose its only edge to the loop check above, and an unattached
  // node is the one thing the graph does not take.
  const attached = new Set<string>();
  for (const edge of edges) {
    attached.add(key(edge.prerequisite));
    attached.add(key(edge.dependent));
  }
  const placed = nodes.filter((node) => {
    if (node.existingId || attached.has(key(node.name))) return true;
    dropped.push({ name: node.name, reason: 'nothing said what it sits under or on top of' });
    return false;
  });
  const kept = new Set(placed.map((node) => key(node.name)));
  const keptEdges = edges.filter(
    (edge) => kept.has(key(edge.prerequisite)) && kept.has(key(edge.dependent)),
  );

  const something = placed.some((node) => node.existingId === null);
  if (!something || !goalConcept) {
    return failure
      ? { ok: false, reason: 'error', detail: failure }
      : { ok: false, reason: 'nothing-in-it', detail: NOTHING_IN_IT };
  }

  return {
    ok: true,
    chain: {
      subject: subject ?? placed[0].name,
      goalConcept,
      nodes: placed,
      edges: keptEdges,
      mentions: placeMentions(mentions, kept, keptEdges),
      joined,
      dropped,
    },
  };
}
