/**
 * The match: your record beside each line of a job description.
 *
 * This is the join the app uniquely knows and a chat window does not, and it
 * pays off before you apply rather than only while you are writing. Four of
 * six must-haves being gaps saves the hour; prose that hides the gaps costs
 * it.
 *
 * One call per role, not one per requirement. Fifteen calls where one will do
 * is the obvious waste, but the real reason is that a per-requirement call
 * cannot see the other requirements, so it cites the same strong story against
 * six lines in a row. Sent together, the model can spread the bank across the
 * description — which is both a better map and an honest one.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { Requirement } from '../jd/requirements';
import { parseMatchPayload, type MatchResult } from './match-payload';
import type { ShortlistItem } from './shortlist';

/**
 * Judgment, and low volume: a few dozen roles you are actually deciding about,
 * not the 341 pursuits in the table. Haiku is the house default where the job
 * is retrieval; deciding whether a story really answers a requirement is not
 * retrieval, and a wrong "covered" costs an hour of writing.
 */
const MODEL = 'claude-opus-5';
const TOOL_NAME = 'report_match';

const SYSTEM = `You match someone's own evidence against the requirements of a job
they are considering, for a job-search assistant.

You are given their evidence bank and then a numbered list of requirements
taken from one job description. For every requirement, report:
- requirement_index: the number as given.
- verdict:
  - strong — an evidence item plainly demonstrates this. Someone reading the
    item would agree it answers the requirement without being argued into it.
  - partial — an item is adjacent: the right domain but less depth, less
    scale, or a related tool rather than the named one.
  - gap — nothing in the bank demonstrates this.
- evidence_item_id: the id of the single best item, copied exactly from the
  bank. Null if and only if the verdict is gap.
- why: one sentence, addressed to the person, naming what does or does not
  line up. "Six years of forecasting, but never in insurance." Not "This is a
  strong match."

Rules that matter more than being generous:

A gap is the useful answer. The point of this map is to tell someone before
they spend an hour whether they can credibly claim the role. Marking a gap as
partial to be encouraging destroys the only thing the map is for. If the bank
does not cover a requirement, say gap.

Spread the evidence. You can see every requirement at once, so use the bank
across the description rather than citing your favourite item six times. Where
two items could answer a line, prefer the one no other line needs.

Never cite an id that is not in the bank you were given, and never invent
detail that is not in an item. If the closest item is only loosely related,
that is partial or gap, not strong.

Judge only what the requirement asks. A requirement naming a number of years is
about that number, not about enthusiasm.`;

export type MatchInput = {
  requirements: readonly Requirement[];
  /** The shortlist. An empty bank is an error upstream, not an empty call. */
  bank: readonly ShortlistItem[];
  /** Title and company, so the model can read a requirement in context. */
  roleLabel: string;
};

export type MatchOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'match-evidence'. */
  onSpend?: SpendSink;
};

/** The bank, as it goes into the cached prefix. */
function renderBank(bank: readonly ShortlistItem[]): string {
  return bank
    .map((item) =>
      [
        `id: ${item.id}`,
        `title: ${item.title}`,
        item.context ? `where: ${item.context}` : null,
        item.metrics ? `result: ${item.metrics}` : null,
        item.skills.length ? `tags: ${item.skills.join(', ')}` : null,
        `story: ${item.body}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n---\n\n');
}

export type MatchOutcome = MatchResult & { cacheReadTokens?: number };

export async function matchRequirements(
  options: MatchOptions,
  input: MatchInput,
): Promise<MatchOutcome> {
  if (input.bank.length === 0) {
    return { ok: false, error: 'Your evidence bank is empty, so there is nothing to match against.' };
  }
  if (input.requirements.length === 0) {
    return { ok: false, error: 'No requirements have been extracted from this description yet.' };
  }

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const numbered = input.requirements
    .map((requirement, index) => `${index}. [${requirement.kind}] ${requirement.text}`)
    .join('\n');

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      // The bank is identical across every role matched, so it goes in the
      // system block behind a cache breakpoint and the role's requirements go
      // last in `messages`. Repeat matches then read the bank from cache at
      // about a tenth the price. If cacheReadTokens comes back zero on a
      // second match, something volatile has leaked into this prefix.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: `The evidence bank:\n\n${renderBank(input.bank)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the verdict for every requirement.',
          input_schema: {
            type: 'object',
            properties: {
              matches: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    requirement_index: { type: 'integer', minimum: 0 },
                    verdict: { type: 'string', enum: ['strong', 'partial', 'gap'] },
                    evidence_item_id: { type: ['string', 'null'] },
                    why: { type: 'string' },
                  },
                  required: ['requirement_index', 'verdict', 'why'],
                },
              },
            },
            required: ['matches'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `Role: ${input.roleLabel}\n\nRequirements:\n${numbered}\n\nCall ${TOOL_NAME} with one entry per requirement.`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Matching is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Match failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Match failed.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No match came back.' };
  }

  const parsed = parseMatchPayload(
    report.input,
    input.requirements,
    input.bank.map((item) => item.id),
  );
  return { ...parsed, cacheReadTokens: response.usage.cache_read_input_tokens ?? 0 };
}
