import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { MODELS } from '@/lib/core/models';
import { forceTool } from '@/lib/learn/graph/tool-call';

/**
 * The sentence above each weekly connection (plan #1115): what a week's notes
 * share with the older note they come back to, written by Haiku from the
 * titles and opening lines, one call for the whole week.
 *
 * The notes are named and linked beside the sentence either way, so a failed
 * call costs the sentence and nothing else: the run stores the connection
 * without one and the page shows the notes alone.
 */

export const CONNECTIONS_MODEL = MODELS.vaultConnections;
const TOOL_NAME = 'write_sentences';

/** Characters of a note's opening passed to the model. */
export const OPENING_CHARS = 500;

const SYSTEM = `You write one sentence for each group of notes from a person's
own notebook. In each group, one or more notes they wrote this week turned out
to be close in subject to an older note of theirs. You get each note's title
and its opening lines.

For each group, say in one plain sentence what the notes have in common, so
the person can decide whether to open them. Address the person as "you".

Rules:
- Name the subject they share, concretely: "pricing a first product",
  "how cities use sensor data". Not "similar themes" or "related ideas".
- Refer to the notes by their titles, exactly as given.
- Say only what the titles and openings support. If the link is loose, say
  what it is and no more.
- At most 30 words. No quotation marks, no em dashes, no exclamation marks.
- Never mention similarity scores, embeddings, or how the notes were found.`;

export type ConnectionForModel = {
  older: { title: string; opening: string };
  recent: { title: string; opening: string }[];
};

export type ConnectionsModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as 'write-note-connections'. */
  onSpend?: SpendSink;
};

/**
 * A note's opening lines as the model reads them: embeds, links and
 * formatting taken out, whitespace closed up, cut at OPENING_CHARS.
 */
export function openingOf(body: string): string {
  return body
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/^>\s*\[![^\]]*\]/gm, ' ')
    .replace(/[#*_`>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OPENING_CHARS);
}

function prompt(groups: readonly ConnectionForModel[]): string {
  return groups
    .map((group, index) => {
      const recent = group.recent
        .map((note) => `  Written this week: ${note.title}\n  Opening: ${note.opening || '(none)'}`)
        .join('\n');
      return `Group ${index + 1}\n  Older note: ${group.older.title}\n  Opening: ${group.older.opening || '(none)'}\n${recent}`;
    })
    .join('\n\n');
}

/**
 * One sentence per group, in the order given; null where the model gave none
 * or the call failed. Never throws.
 */
export async function writeConnectionSentences(
  groups: readonly ConnectionForModel[],
  options: ConnectionsModelOptions,
): Promise<(string | null)[]> {
  const none = groups.map(() => null);
  if (groups.length === 0) return none;
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: CONNECTIONS_MODEL,
      max_tokens: 800,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Give the sentence for each group, by group number.',
          input_schema: {
            type: 'object',
            properties: {
              sentences: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    group: { type: 'integer' },
                    sentence: { type: 'string' },
                  },
                  required: ['group', 'sentence'],
                },
              },
            },
            required: ['sentences'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, CONNECTIONS_MODEL),
      messages: [{ role: 'user', content: prompt(groups) }],
    });
  } catch (error) {
    console.error('[vault connections] writing the sentences failed', error instanceof Error ? error.message : error);
    return none;
  }
  options.onSpend?.({ model: CONNECTIONS_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return none;
  const input = block.input as { sentences?: unknown };
  if (!Array.isArray(input.sentences)) return none;

  const out: (string | null)[] = [...none];
  for (const item of input.sentences as { group?: unknown; sentence?: unknown }[]) {
    const index = typeof item.group === 'number' ? item.group - 1 : -1;
    const sentence = typeof item.sentence === 'string' ? cleanSentence(item.sentence) : '';
    if (index >= 0 && index < out.length && sentence) out[index] = sentence;
  }
  return out;
}

/** A sentence as stored: one line, trimmed, capped, ending in a full stop. */
export function cleanSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(/\s[—–]\s/g, ', ').trim();
  if (!line) return '';
  const capped = line.length > 300 ? `${line.slice(0, 297).trimEnd()}…` : line;
  return /[.?…]$/.test(capped) ? capped : `${capped}.`;
}
