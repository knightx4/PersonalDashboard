import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { MayaMaterial } from './retrieve';

/**
 * The call that writes Maya's thought on one note (plan #1284).
 *
 * Opus, with the web search tool for the exact wording of an outside source
 * and one report tool. The report cannot be forced on the first request,
 * because a forced tool leaves no room to search, so the first request lets
 * the model choose; if it stops without reporting, one more request forces
 * the report with the searches already in the conversation. A turn the server
 * pauses after ten rounds of searching is sent back as it is, as in
 * lib/news/recommend/make.ts.
 *
 * Notes and positions are labelled N1, P1 and so on in the prompt, so the
 * model copies a short label rather than a uuid; verify.ts maps them back.
 * Nothing here checks what the model said. That is verify.ts.
 */

export const THOUGHT_MODEL = 'claude-opus-5';
const TOOL_NAME = 'report_thought';

/** At most this many points reach the person. */
export const MAYA_MAX_POINTS = 3;

/** maya_threads.question is at most this long. */
export const MAYA_QUESTION_MAX = 200;

/** Characters of the note itself in the prompt. */
export const SUBJECT_CHARS = 12_000;

/**
 * Characters of each related note in the prompt. Cut from 3,000 on
 * 30 September 2026: the first two thoughts read 70,000 tokens each, about
 * $0.55, and the quotes a point cites are a sentence or two.
 */
export const RELATED_CHARS = 1_500;

/**
 * Searches are for a source's exact wording; the sources themselves come from
 * what the model already knows. Each result is read back as input on every
 * later round, so this was cut from 5 with RELATED_CHARS.
 */
export const MAX_SEARCHES = 2;
const MAX_CONTINUATIONS = 3;

export const MAYA_SYSTEM = `You are Maya, a thought partner for one person who keeps their notes in
Obsidian. You are given one of their notes, the other notes of theirs nearest
it, and positions their notes have been read as holding. You write a short
thought on the note: at most three points, the ones that would most change how
they think about it.

WHAT A POINT IS
A point makes a claim about the note and argues for it with material: what the
person has written elsewhere, and what serious thinkers have written on the
same question. Bring material and take a view. Never ask the person to reflect,
to "think of a time", or to consider a question. A claim is a statement and
never ends in a question mark.

THE BAR
Rank the points by how much each would change the person's thinking, most
first. Give fewer than three when fewer clear the bar, and none when nothing
does. Picking the few that matter is the job, so leave out the merely
interesting, the obvious, and anything that restates the note back to them.

THEIR OWN NOTES COME FIRST
Use their other notes wherever they bear on this one. Where two of their notes
disagree, or this note disagrees with an earlier one, that comes before
anything else. Each note you bring in carries a substantive point: say what
that note holds and how it bears on this one. "You wrote about this in X" is
not a point. For example: "Your essay puts action last, as the expression of a
self already found; this note makes action the way the self is found."
Quote each note you cite with a short passage copied character for character
from it, as given. A quote that is not in the note is thrown away, and the
citation with it.

OUTSIDE SOURCES
Bring in outside thinkers where they sharpen a point: philosophers, novelists,
psychologists, and serious researchers or practitioners. Name the author and
the specific work. Never cite a blog post, a listicle, or an unnamed "some
say". Give the gist in your own words. When you want their exact words, search
for the passage, write it out in your reply text so the search result is cited,
and give it as exact_text. Leave exact_text empty when you have not found the
passage in a search; the gist alone is enough.

A SYNTHESIS
Only when the note turns on two of their positions that are listed as
conflicting, draft the view that reconciles them, in a few sentences, and name
the two positions by label. Otherwise leave synthesis out. Never draft one for
positions not listed as conflicting.

THE QUESTION
Name the question the note is working on in one line, under 200 characters.

HOW TO WRITE
Plain, direct prose addressed to the person as "you". Short sentences. No
headings, no slogans, no rhetorical contrast of the form "not X, but Y", and no
dashes used for rhythm. Say what the material says and what follows from it.`;

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export type ThoughtLabels = {
  /** N1 → note id. The note itself is not labelled: it is not cited. */
  notes: Map<string, string>;
  /** P1 → position id. */
  positions: Map<string, string>;
};

function cut(text: string, chars: number): string {
  const trimmed = text.trim();
  return trimmed.length > chars ? `${trimmed.slice(0, chars)}\n[cut]` : trimmed;
}

/** The user message for a note's material, and the labels used in it. */
export function buildThoughtPrompt(material: MayaMaterial): { prompt: string; labels: ThoughtLabels } {
  const labels: ThoughtLabels = { notes: new Map(), positions: new Map() };
  const noteLabel = new Map<string, string>();
  const labelNote = (id: string): string => {
    let label = noteLabel.get(id);
    if (!label) {
      label = `N${noteLabel.size + 1}`;
      noteLabel.set(id, label);
      labels.notes.set(label, id);
    }
    return label;
  };

  const lines: string[] = [];
  lines.push(`THE NOTE: ${material.note.title}`, '', cut(material.note.body, SUBJECT_CHARS), '');

  if (material.related.length > 0) {
    lines.push('THEIR OTHER NOTES NEAREST IT, closest first:', '');
    for (const note of material.related) {
      lines.push(`[${labelNote(note.id)}] ${note.title}`, cut(note.body, RELATED_CHARS), '');
    }
  } else {
    lines.push('None of their other notes is close to this one.', '');
  }

  const positionLabel = new Map<string, string>();
  if (material.positions.length > 0) {
    lines.push('POSITIONS THEIR NOTES HOLD, with the passages they were read from:', '');
    material.positions.forEach((position, index) => {
      const label = `P${index + 1}`;
      positionLabel.set(position.id, label);
      labels.positions.set(label, position.id);
      const where =
        position.via === 'this-note' ? 'from this note' : position.via === 'related-note' ? 'from a related note' : 'shares a theme';
      lines.push(`[${label}] ${position.name} (${position.stance}, ${where}): ${position.statement}`);
      for (const quote of position.quotes) {
        if (quote.noteId === material.note.id) {
          lines.push(`  this note: "${quote.quote}"`);
        } else {
          lines.push(`  [${labelNote(quote.noteId)}] ${quote.noteTitle}: "${quote.quote}"`);
        }
      }
      lines.push('');
    });
  }

  if (material.conflicts.length > 0) {
    lines.push('POSITIONS OF THEIRS THAT CONFLICT:');
    for (const conflict of material.conflicts) {
      const left = positionLabel.get(conflict.leftId);
      const right = positionLabel.get(conflict.rightId);
      if (!left || !right) continue;
      lines.push(`- ${left} and ${right}${conflict.crux ? `: ${conflict.crux}` : ''}`);
    }
    lines.push('');
  } else {
    lines.push('No two of these positions are recorded as conflicting, so give no synthesis.', '');
  }

  lines.push(`Search if you need a source's exact words, then call ${TOOL_NAME} once.`);
  return { prompt: lines.join('\n'), labels };
}

// ---------------------------------------------------------------------------
// The tool and what it reports
// ---------------------------------------------------------------------------

const REPORT_TOOL = {
  name: TOOL_NAME,
  description: 'Report the thought: the question, up to three ranked points, and a synthesis only on a listed conflict.',
  input_schema: {
    type: 'object' as const,
    properties: {
      question: { type: 'string', description: 'The question the note is working on, one line under 200 characters.' },
      points: {
        type: 'array',
        maxItems: MAYA_MAX_POINTS,
        items: {
          type: 'object',
          properties: {
            rank: { type: 'integer', description: '1 for the point that would most change their thinking.' },
            claim: { type: 'string', description: 'One sentence stating the view. Not a question.' },
            argument: { type: 'string', description: 'A short paragraph arguing it from the material.' },
            notes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  note: { type: 'string', description: 'The label, such as N2.' },
                  quote: { type: 'string', description: 'A passage copied exactly from that note.' },
                  point: { type: 'string', description: 'What that note holds and how it bears on this one.' },
                },
                required: ['note', 'quote', 'point'],
              },
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  author: { type: 'string' },
                  work: { type: 'string', description: 'The specific book, essay, or paper.' },
                  gist: { type: 'string', description: 'What it says that bears on the point, in your words.' },
                  exact_text: {
                    type: ['string', 'null'],
                    description: 'The exact words, only when a search found them. Otherwise null.',
                  },
                },
                required: ['author', 'work', 'gist'],
              },
            },
          },
          required: ['rank', 'claim', 'argument', 'notes', 'sources'],
        },
      },
      synthesis: {
        type: ['object', 'null'],
        description: 'Only when the note turns on two listed conflicting positions.',
        properties: {
          positions: { type: 'array', items: { type: 'string' }, description: 'The two labels, such as ["P1", "P3"].' },
          resolution: { type: 'string' },
        },
        required: ['positions', 'resolution'],
      },
    },
    required: ['question', 'points'],
  },
};

const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES } as unknown as Anthropic.Tool,
  REPORT_TOOL,
];

const text = z.string().trim();

export const rawNoteCitationSchema = z.object({ note: text, quote: z.string(), point: text.min(1) });
export const rawSourceSchema = z.object({
  author: text.min(1),
  work: text.min(1),
  gist: text.min(1),
  exact_text: z.string().nullish(),
});
export const rawPointSchema = z.object({
  rank: z.coerce.number().int().catch(99),
  claim: text.min(1),
  argument: text.min(1),
  notes: z.array(z.unknown()).catch([]),
  sources: z.array(z.unknown()).catch([]),
});
export const rawSynthesisSchema = z.object({ positions: z.array(text), resolution: text.min(1) });

export type RawNoteCitation = z.infer<typeof rawNoteCitationSchema>;
export type RawSource = z.infer<typeof rawSourceSchema>;
export type RawPoint = Omit<z.infer<typeof rawPointSchema>, 'notes' | 'sources'> & {
  notes: RawNoteCitation[];
  sources: RawSource[];
};
export type RawThought = {
  question: string;
  points: RawPoint[];
  synthesis: z.infer<typeof rawSynthesisSchema> | null;
};

/**
 * The report as the model gave it, each part parsed on its own so one
 * malformed citation costs that citation and not the thought. Null when there
 * is no usable report at all.
 */
export function parseReport(input: unknown): RawThought | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (!Array.isArray(record.points)) return null;

  const points: RawPoint[] = [];
  for (const entry of record.points) {
    const parsed = rawPointSchema.safeParse(entry);
    if (!parsed.success) continue;
    points.push({
      ...parsed.data,
      notes: parsed.data.notes.flatMap((n) => {
        const ok = rawNoteCitationSchema.safeParse(n);
        return ok.success ? [ok.data] : [];
      }),
      sources: parsed.data.sources.flatMap((s) => {
        const ok = rawSourceSchema.safeParse(s);
        return ok.success ? [ok.data] : [];
      }),
    });
  }

  const synthesis = rawSynthesisSchema.safeParse(record.synthesis);
  return { question, points, synthesis: synthesis.success ? synthesis.data : null };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

type Block = { type: string; name?: string; input?: unknown; citations?: unknown };

/**
 * The passages the web search tool returned and the model cited, across every
 * response of the call. Result pages come back encrypted, so a cited passage
 * (`cited_text` on a text block's `web_search_result_location` citation) is
 * the only search text the app can read, and the only text an exact quote can
 * be checked against.
 */
export function citedSearchText(content: readonly Block[]): string[] {
  const out: string[] = [];
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const citation of block.citations as { type?: unknown; cited_text?: unknown }[]) {
      if (citation?.type === 'web_search_result_location' && typeof citation.cited_text === 'string') {
        out.push(citation.cited_text);
      }
    }
  }
  return out;
}

export type ThoughtCall =
  | { ok: true; raw: RawThought; labels: ThoughtLabels; searchText: string[] }
  | { ok: false; detail: string };

/** Ask the model for a thought on the material. Never throws. */
export async function callThoughtModel(
  material: MayaMaterial,
  options: {
    anthropicApiKey?: string;
    client?: Pick<Anthropic, 'messages'>;
    onSpend?: SpendSink;
  },
): Promise<ThoughtCall> {
  if (!options.client && !options.anthropicApiKey) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set.' };
  const client = options.client ?? new Anthropic({ apiKey: options.anthropicApiKey });
  const { prompt, labels } = buildThoughtPrompt(material);
  // Cached: every search round and the forced follow-up resend the system
  // prompt and the material, which then cost a tenth as much after the first.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: MAYA_SYSTEM, cache_control: { type: 'ephemeral' } },
  ];
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }] },
  ];
  const searchText: string[] = [];
  let forced = false;

  try {
    for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn += 1) {
      const response = await client.messages.create({
        model: THOUGHT_MODEL,
        max_tokens: 6_000,
        system,
        tools: TOOLS,
        ...(forced ? { tool_choice: forceTool(TOOL_NAME) } : {}),
        messages,
      });
      options.onSpend?.({ model: THOUGHT_MODEL, usage: usageFrom(response.usage) });
      const content = response.content as unknown as Block[];
      searchText.push(...citedSearchText(content));

      const block = content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
      if (block) {
        const raw = parseReport(block.input);
        if (!raw) return { ok: false, detail: 'The thought came back in a shape that could not be read.' };
        return { ok: true, raw, labels, searchText };
      }

      // Widened: the installed SDK's type predates these reasons.
      const stop: string | null = response.stop_reason;
      if (stop === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      if (stop === 'refusal') return { ok: false, detail: 'The model declined to write a thought.' };
      if (forced || stop === 'max_tokens') return { ok: false, detail: whyNoReport(response) };
      // It stopped without reporting. Ask once more with the report forced,
      // keeping what it searched and wrote.
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: `Now report the thought through ${TOOL_NAME}.` });
      forced = true;
    }
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited. Try again shortly.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The thought failed.' };
  }
  return { ok: false, detail: 'The thought did not finish.' };
}
