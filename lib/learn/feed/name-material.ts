import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { FeedTarget } from './targets';

/**
 * Naming what to read for one target (LEARN-NOW-SPEC, "How cards are made",
 * step 2).
 *
 * One call per target. The model is given the theme or the field and names two
 * or three Wikipedia articles, with the section in each, that someone in that
 * position should read next. Nothing it names is trusted: the pass fetches
 * every title and drops the ones Wikipedia does not have, and a section it
 * cannot find in the fetched article falls back to the article's lead.
 *
 * Sonnet, because the spec prices the feed at two Sonnet calls per card, and
 * naming well-known articles does not need more.
 */

export const NAME_MATERIAL_MODEL = 'claude-sonnet-5';

/** The most articles kept from one call. */
export const MAX_NAMED = 3;

const TOOL_NAME = 'report_reading';

export type NamedSection = {
  /** The article title as the model gave it. */
  article: string;
  /** The section heading, or null for the article's lead. */
  section: string | null;
  /** One sentence on why it suits the target. */
  basis: string;
};

export type NameResult = { ok: true; named: NamedSection[] } | { ok: false; detail: string };

const SYSTEM = `You choose what one person should read next on English Wikipedia.

You are given either a theme from their own notes, with the field of study it
belongs to, or a field of study they have never looked at. Name two or three
Wikipedia articles, and one section in each, that would teach them something
worth knowing about it.

- Use exact English Wikipedia article titles, as they appear at the top of the
  article. Prefer established articles over obscure ones: a title that does not
  exist is thrown away.
- Name a real section heading from that article, as written there. Use null for
  the article's lead when the lead is the part worth reading.
- For a theme, pick sections that go deeper into the ideas behind it, not a
  restatement of it. For a field they have never looked at, pick sections that
  would make a good first read: a central idea, a founding result, a clear
  overview.
- Each pick is a different article.
- "basis" is one sentence, under 25 words, saying why this section suits this
  person.

Report through ${TOOL_NAME}.`;

const payloadSchema = z.object({
  picks: z.array(
    z.object({
      article: z.string(),
      section: z.string().nullable().optional(),
      basis: z.string(),
    }),
  ),
});

/** What the model is told about the target. Exported for the test. */
export function describeTarget(target: FeedTarget): string {
  const field = `${target.field.name} (${target.field.domain}). ${target.field.scope}`;
  if (target.reason === 'interest') {
    return [
      `A theme from their notes: ${target.theme.name}.`,
      `What the writing under it is about: ${target.theme.about}`,
      `The field it belongs to: ${field}`,
    ].join('\n');
  }
  return target.gap === 'untested'
    ? `A field they write about and have never been tested in: ${field}`
    : `A field they have never written about or studied: ${field}`;
}

/**
 * Read the tool payload.
 *
 * Pure, and exported for the test. A pick is kept when it has a title and a
 * basis, names an article not already picked in this reply, and is not in
 * `avoid` (articles this person already has cards from). At most MAX_NAMED
 * are kept. An empty or whitespace section is the lead.
 */
export function readNamed(input: unknown, avoid: ReadonlySet<string>): NameResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The report did not match its schema.' };

  const seen = new Set<string>();
  const named: NamedSection[] = [];
  for (const pick of parsed.data.picks) {
    const article = pick.article.trim();
    const basis = pick.basis.trim();
    const key = articleKey(article);
    if (!article || !basis || seen.has(key) || avoid.has(key)) continue;
    seen.add(key);
    const section = pick.section?.trim() || null;
    named.push({ article, section, basis });
    if (named.length === MAX_NAMED) break;
  }
  if (named.length === 0) return { ok: false, detail: 'The call named nothing new to read.' };
  return { ok: true, named };
}

/** How article titles are compared: case and underscores do not matter. */
export function articleKey(title: string): string {
  return title.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

export async function nameMaterial(input: {
  target: FeedTarget;
  /** Articles this person already has cards from, by title. */
  avoid: string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<NameResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const avoidList = input.avoid.slice(0, 60);

  let response;
  try {
    response = await client.messages.create({
      model: NAME_MATERIAL_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the Wikipedia sections this person should read next.',
          input_schema: {
            type: 'object',
            properties: {
              picks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    article: { type: 'string' },
                    section: { type: ['string', 'null'] },
                    basis: { type: 'string' },
                  },
                  required: ['article', 'section', 'basis'],
                },
              },
            },
            required: ['picks'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [
        {
          role: 'user',
          content: [
            describeTarget(input.target),
            '',
            avoidList.length > 0
              ? `They already have these articles; name others:\n${avoidList.map((title) => `- ${title}`).join('\n')}`
              : 'They have no articles yet.',
            '',
            `Call ${TOOL_NAME} with two or three picks.`,
          ].join('\n'),
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The naming call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: NAME_MATERIAL_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  return readNamed(block.input, new Set(input.avoid.map(articleKey)));
}
