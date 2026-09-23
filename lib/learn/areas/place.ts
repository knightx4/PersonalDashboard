import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { Level3Article } from '@/lib/learn/areas/level3';

/**
 * Placing things into the areas (docs/LEARN-AREAS-SPEC.md).
 *
 * Three callers, one call. The check places Wikipedia's Level 3 articles to
 * test the grid, theme placement puts each vault theme where it belongs, and
 * track placement puts each learn subject in the field it studies. All
 * hand the model every field with its scope, which is where the boundary rules
 * live, and a batch of named items with a line of context each. For each item
 * it names a field (or, for an umbrella, a domain), a runner-up when one is
 * worth naming, and how sure it is.
 *
 * They differ in one respect. An encyclopedia article is always about
 * something a field studies, so the check never leaves one out. A theme can be
 * a trip being planned or the plot of a story being written, and a track can
 * span two domains, so theme and track placement may answer "unplaced".
 *
 * Opus, because the value is in the close calls. Forty items is one call.
 */

export const PLACE_MODEL = 'claude-opus-5';

/** Items per call. Small enough that one reply fits well inside max_tokens. */
export const PLACE_BATCH = 40;

const TOOL_NAME = 'report_placements';

export type AreaField = { slug: string; name: string; scope: string; domain: string };

/** A domain, which an umbrella item is placed at instead of a field. */
export type AreaDomain = { slug: string; name: string; scope: string };

/** One thing to place: its name, and a line saying what it is. */
export type PlaceItem = { title: string; context: string };

/** How a domain is named to the model, so it cannot be mistaken for a field slug. */
const DOMAIN_PREFIX = 'domain:';

/** The answer for a theme that is not about any field of study. */
export const UNPLACED = 'unplaced';

export type Placement = {
  title: string;
  kind: 'topic' | 'person' | 'place' | 'work';
  /** At most one of these two is set: a field, or for an umbrella, its domain. Neither is unplaced. */
  field: string | null;
  domain: string | null;
  runnerUp: string | null;
  confidence: 'clear' | 'close' | 'none';
  basis: string;
};

export type PlaceResult =
  | { ok: true; placements: Placement[]; dropped: string[] }
  | { ok: false; detail: string };

/** What the check says about its items, ahead of the shared rules. */
const CHECK_INTRO = `You are checking whether a fixed list of fields of study is
mutually exclusive and collectively exhaustive. You are given the fields, each
with a scope that says what belongs there and where the nearest things that do
not belong there go instead. Then you are given a batch of encyclopedia
articles, each with the heading Wikipedia filed it under.

For every article, decide which ONE field it belongs in.`;

/** What theme placement says about its items, ahead of the shared rules. */
const THEME_INTRO = `You are placing the themes of one person's notes into a fixed
list of fields of study, so they can see which fields their writing falls in.
You are given the fields, each with a scope that says what belongs there and
where the nearest things that do not belong there go instead. Then you are given
a batch of themes, each with a line saying what the writing under it is about.
The themes were found by reading the notes, so they are often phrased as ideas
or tensions rather than as subjects.

For every theme, decide which ONE field its subject matter belongs in: the field
a person would study to go deeper on what the theme is about.

A theme that is not about any field of study goes nowhere: answer "${UNPLACED}"
as field. That covers personal logistics and errands, and the plot, setting or
characters of a story the person is writing, unless the theme is really about
an idea the story explores, in which case place the idea.`;

/** What track placement says about its items, ahead of the shared rules. */
const TRACK_INTRO = `You are placing one person's study tracks into a fixed list of
fields of study, so they can see which fields they have been tested in. You are
given the fields, each with a scope that says what belongs there and where the
nearest things that do not belong there go instead. Then you are given the
tracks, each with a line saying what it covers.

For every track, decide which ONE field it belongs in. A track narrower than a
field goes in the field that contains it. A track that straddles two fields goes
in the one where most of its ideas would be taught.

A track that spans more than one domain has nothing above a domain to go in:
answer "${UNPLACED}" as field, and say so in the basis.`;

const SHARED_RULES = `- A topic goes in the field that studies it. Follow the scope sentences: they
  settle the common overlaps, and where one says something belongs elsewhere,
  it does.
- An umbrella that covers a whole domain rather than one of its fields
  ("Technology", "The arts") goes at the domain itself: give "domain:<slug>" as
  field. Use this only when it spans every field in the domain. Something that
  is mostly about one field goes in that field.
- A person goes in the field of the work they are known for. A place goes where
  most writing about it would go: its history, its politics, or, for a place
  in general, Human geography. A work (a book, a painting, a piece of music)
  goes in the field of its medium.

Then say how sure you are:

- "clear": one field fits and no other comes close.
- "close": a second field fits nearly as well. Name it as runner_up. Say so
  honestly rather than picking confidently.
- "none": no field really fits. Give the least bad one as field.

"basis" is one sentence, under 25 words, saying why. For "close" and "none",
say what the scopes fail to settle.

Report every item in the batch through ${TOOL_NAME}, using the field slugs
(or "domain:" slugs) exactly as given, and the titles exactly as given.`;

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

function fieldList(fields: AreaField[], domains: AreaDomain[]): string {
  const domainLine = new Map(domains.map((d) => [d.name, `${DOMAIN_PREFIX}${d.slug}: ${d.scope}`]));
  let domain = '';
  const lines: string[] = [];
  for (const field of fields) {
    if (field.domain !== domain) {
      domain = field.domain;
      lines.push('', `## ${domain}`, domainLine.get(domain) ?? '');
    }
    lines.push(`- ${field.slug}: ${field.name}. ${field.scope}`);
  }
  return lines.join('\n').trim();
}

/**
 * Read the tool payload against the batch it answers.
 *
 * Pure, and exported for the test. A placement is kept only when its title is
 * one that was asked about and its target is a real field slug, `domain:` and
 * a real domain slug, or, where `allowUnplaced` is set, `unplaced`. A runner-up
 * that is not a real field slug, or is the same as the field, is dropped
 * rather than kept wrong. Titles asked about and not answered come back in
 * `dropped`, and stay unplaced for the next call.
 */
export function readPlacements(
  input: unknown,
  batch: { title: string }[],
  slugs: ReadonlySet<string>,
  domainSlugs: ReadonlySet<string> = new Set(),
  allowUnplaced = false,
): PlaceResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The report did not match its schema.' };

  const asked = new Map(batch.map((item) => [item.title.toLowerCase(), item.title]));
  const placements: Placement[] = [];
  const answered = new Set<string>();

  for (const item of parsed.data.placements) {
    const title = asked.get(item.title.trim().toLowerCase());
    const basis = item.basis.trim();
    const target = item.field.trim();
    const unplaced = allowUnplaced && target === UNPLACED;
    const domain = target.startsWith(DOMAIN_PREFIX) ? target.slice(DOMAIN_PREFIX.length) : null;
    const field = unplaced || domain !== null ? null : target;
    const known = unplaced || (domain !== null ? domainSlugs.has(domain) : slugs.has(target));
    if (!title || answered.has(title) || !known || !basis) continue;

    const runnerUp =
      !unplaced && item.runner_up && slugs.has(item.runner_up) && item.runner_up !== field
        ? item.runner_up
        : null;

    answered.add(title);
    placements.push({
      title,
      kind: item.kind,
      field,
      domain,
      runnerUp,
      confidence: item.confidence,
      basis,
    });
  }

  const dropped = batch.map((item) => item.title).filter((title) => !answered.has(title));
  return { ok: true, placements, dropped };
}

type PlaceInput = {
  fields: AreaField[];
  domains: AreaDomain[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
};

async function placeItems(
  input: PlaceInput & { items: PlaceItem[]; intro: string; listHeading: string; allowUnplaced: boolean },
): Promise<PlaceResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const slugs = new Set(input.fields.map((field) => field.slug));
  const domainSlugs = new Set(input.domains.map((domain) => domain.slug));

  let response;
  try {
    response = await client.messages.create({
      model: PLACE_MODEL,
      max_tokens: 8192,
      system: `${input.intro}\n\n${SHARED_RULES}`,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the field each item in the batch belongs in.',
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
            fieldList(input.fields, input.domains),
            '',
            input.listHeading,
            '',
            ...input.items.map((item) => `- ${item.title} (${item.context})`),
            '',
            `Call ${TOOL_NAME} with all ${input.items.length}.`,
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

  return readPlacements(block.input, input.items, slugs, domainSlugs, input.allowUnplaced);
}

/** The check: Level 3 articles, each always placed somewhere. */
export function placeArticles(input: PlaceInput & { batch: Level3Article[] }): Promise<PlaceResult> {
  return placeItems({
    ...input,
    items: input.batch.map((article) => ({ title: article.title, context: article.section })),
    intro: CHECK_INTRO,
    listHeading: 'The articles, as "title (where Wikipedia filed it)":',
    allowUnplaced: false,
  });
}

/** Theme placement: vault themes, which may be left unplaced. */
export function placeThemes(input: PlaceInput & { themes: PlaceItem[] }): Promise<PlaceResult> {
  return placeItems({
    ...input,
    items: input.themes,
    intro: THEME_INTRO,
    listHeading: 'The themes, as "name (what the writing under it is about)":',
    allowUnplaced: true,
  });
}

/** Track placement: learn subjects, one at a time as each is created. */
export function placeTracks(input: PlaceInput & { tracks: PlaceItem[] }): Promise<PlaceResult> {
  return placeItems({
    ...input,
    items: input.tracks,
    intro: TRACK_INTRO,
    listHeading: 'The tracks, as "name (what it covers)":',
    allowUnplaced: true,
  });
}
