import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { Level3Article } from '@/lib/learn/areas/level3';

/**
 * Placing Level 3 articles into the areas, for the check in
 * docs/LEARN-AREAS-SPEC.md.
 *
 * One call per batch. The model is given every field with its scope, which is
 * where the boundary rules live, and a batch of articles with the heading each
 * sat under. For each article it names a field, a runner-up when one is worth
 * naming, and how sure it is. The findings the check exists for are the
 * articles it is not sure about, so the prompt asks it to say so rather than
 * to pick confidently.
 *
 * Opus, because the whole value of the run is in the close calls, and a
 * thousand short titles in batches of forty is about twenty-five calls.
 */

export const PLACE_MODEL = 'claude-opus-5';

/** Articles per call. Small enough that one reply fits well inside max_tokens. */
export const PLACE_BATCH = 40;

const TOOL_NAME = 'report_placements';

export type AreaField = { slug: string; name: string; scope: string; domain: string };

export type Placement = {
  title: string;
  kind: 'topic' | 'person' | 'place' | 'work';
  field: string;
  runnerUp: string | null;
  confidence: 'clear' | 'close' | 'none';
  basis: string;
};

export type PlaceResult =
  | { ok: true; placements: Placement[]; dropped: string[] }
  | { ok: false; detail: string };

const SYSTEM = `You are checking whether a fixed list of fields of study is
mutually exclusive and collectively exhaustive. You are given the fields, each
with a scope that says what belongs there and where the nearest things that do
not belong there go instead. Then you are given a batch of encyclopedia
articles, each with the heading Wikipedia filed it under.

For every article, decide which ONE field it belongs in.

- A topic goes in the field that studies it. Follow the scope sentences: they
  settle the common overlaps, and where one says something belongs elsewhere,
  it does.
- A person goes in the field of the work they are known for. A place goes where
  most writing about it would go: its history, its politics, or, for a place
  in general, Human geography. A work (a book, a painting, a piece of music)
  goes in the field of its medium.

Then say how sure you are:

- "clear": one field fits and no other comes close.
- "close": a second field fits nearly as well. Name it as runner_up. This is a
  finding, not a failure: it shows a boundary the scopes do not settle, so say
  so honestly rather than picking confidently.
- "none": no field really fits. Give the least bad one as field. This is the
  most useful finding of all, because it shows a field is missing.

"basis" is one sentence, under 25 words, saying why. For "close" and "none",
say what the scopes fail to settle.

Report every article in the batch through ${TOOL_NAME}, using the field slugs
exactly as given, and the article titles exactly as given.`;

const payloadSchema = z.object({
  placements: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(['topic', 'person', 'place', 'work']),
      field: z.string(),
      runner_up: z.string().nullable().optional(),
      confidence: z.enum(['clear', 'close', 'none']),
      basis: z.string(),
    }),
  ),
});

function fieldList(fields: AreaField[]): string {
  let domain = '';
  const lines: string[] = [];
  for (const field of fields) {
    if (field.domain !== domain) {
      domain = field.domain;
      lines.push('', `## ${domain}`);
    }
    lines.push(`- ${field.slug}: ${field.name}. ${field.scope}`);
  }
  return lines.join('\n').trim();
}

/**
 * Read the tool payload against the batch it answers.
 *
 * Pure, and exported for the test. A placement is kept only when its title is
 * one that was asked about and its field is a real slug; a runner-up that is
 * not a real slug, or is the same as the field, is dropped rather than kept
 * wrong. Titles asked about and not answered come back in `dropped`, and stay
 * unplaced for the next call.
 */
export function readPlacements(
  input: unknown,
  batch: Level3Article[],
  slugs: ReadonlySet<string>,
): PlaceResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The report did not match its schema.' };

  const asked = new Map(batch.map((article) => [article.title.toLowerCase(), article.title]));
  const placements: Placement[] = [];
  const answered = new Set<string>();

  for (const item of parsed.data.placements) {
    const title = asked.get(item.title.trim().toLowerCase());
    const basis = item.basis.trim();
    if (!title || answered.has(title) || !slugs.has(item.field) || !basis) continue;

    const runnerUp =
      item.runner_up && slugs.has(item.runner_up) && item.runner_up !== item.field ? item.runner_up : null;

    answered.add(title);
    placements.push({
      title,
      kind: item.kind,
      field: item.field,
      runnerUp,
      confidence: item.confidence,
      basis,
    });
  }

  const dropped = batch.map((article) => article.title).filter((title) => !answered.has(title));
  return { ok: true, placements, dropped };
}

export async function placeArticles(input: {
  batch: Level3Article[];
  fields: AreaField[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<PlaceResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const slugs = new Set(input.fields.map((field) => field.slug));

  let response;
  try {
    response = await client.messages.create({
      model: PLACE_MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the field each article in the batch belongs in.',
          input_schema: {
            type: 'object',
            properties: {
              placements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    kind: { type: 'string', enum: ['topic', 'person', 'place', 'work'] },
                    field: { type: 'string' },
                    runner_up: { type: ['string', 'null'] },
                    confidence: { type: 'string', enum: ['clear', 'close', 'none'] },
                    basis: { type: 'string' },
                  },
                  required: ['title', 'kind', 'field', 'confidence', 'basis'],
                },
              },
            },
            required: ['placements'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: [
            'The fields:',
            '',
            fieldList(input.fields),
            '',
            'The articles, as "title (where Wikipedia filed it)":',
            '',
            ...input.batch.map((article) => `- ${article.title} (${article.section})`),
            '',
            `Call ${TOOL_NAME} with all ${input.batch.length}.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, detail: 'Rate limited.' };
    }
    return { ok: false, detail: error instanceof Error ? error.message : 'The placement call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: PLACE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  return readPlacements(block.input, input.batch, slugs);
}
