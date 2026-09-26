/**
 * Learning tracks for the career goals (job_search.learning_tracks, 0027).
 *
 * Reads the person's career goals entries and suggests the subjects worth
 * learning to get the job they describe. Each suggestion is a track they can
 * start in Learn with one press; nothing reaches Learn without that press.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { AIM_DEPTH_LABELS } from '@/lib/learn/aims';
import { MAX_SUGGESTIONS, parseSuggestionPayload, trackKey, type SuggestionResult } from './payload';

/**
 * Judgement about what a career needs, from free writing. Opus, as the other
 * Jobs calls that read the person's own words are.
 */
export const SUGGEST_MODEL = 'claude-opus-5';
const TOOL_NAME = 'suggest_learning_tracks';

/** How much of the career goals writing is sent, newest entry first. */
const ENTRIES_MAX_CHARS = 16_000;

const SYSTEM = `You help someone decide what to learn for their career. You read what they
wrote about the job they want next and where they are now, and you suggest
learning tracks: subjects they can study, one at a time, that close the gap
between the two.

A good track:
- is a subject that can be learned from reading, courses and practice, named
  the way a course or a book would name it. "SQL for analytics", "Negotiating
  job offers", "System design for backend engineers". Not a task ("update your
  CV"), not a trait ("be more confident"), not a whole field ("computer
  science").
- follows from what they wrote. The why names the part of their writing it
  serves, in one or two plain sentences addressed to them as "you".
- has a depth: familiar (enough to recognise it and follow a conversation),
  solid (enough to use it and explain it) or deep (the detail a specialist
  would expect). Pick the depth the target job needs, not the most.
- has an about line saying what the track covers, in one sentence.

Put the tracks in the order you would study them, the one that matters most for
the next job first. Suggest ${MAX_SUGGESTIONS} or fewer; three strong tracks beat five padded
ones. Do not suggest anything close to a track they already have or have turned
down; those are listed.

If the writing says nothing about work they want to do, set no_data true and
suggest nothing.`;

export type SuggestTracksInput = {
  /** Career goals entries, newest first. */
  entries: readonly { written: string; body: string }[];
  /** Tracks and Learn goals they already have, and suggestions they turned down. */
  have: readonly string[];
  declined: readonly string[];
};

export type SuggestTracksOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'suggest-learning-tracks'. */
  onSpend?: SpendSink;
};

/** The entries as the prompt gives them, newest first, cut to the budget. */
export function entriesText(entries: SuggestTracksInput['entries']): string {
  const parts: string[] = [];
  let used = 0;
  for (const [index, entry] of entries.entries()) {
    const label = index === 0 ? `${entry.written} (latest)` : entry.written;
    const block = `## ${label}\n\n${entry.body.trim()}`;
    if (used + block.length > ENTRIES_MAX_CHARS) {
      if (index === 0) parts.push(block.slice(0, ENTRIES_MAX_CHARS));
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n\n');
}

function listed(title: string, names: readonly string[]): string {
  if (names.length === 0) return '';
  return `\n\n${title}:\n${names.slice(0, 80).map((name) => `- ${name}`).join('\n')}`;
}

export async function suggestLearningTracks(
  options: SuggestTracksOptions,
  input: SuggestTracksInput,
): Promise<SuggestionResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const prompt =
    `Their career goals entries, newest first. Where two disagree, the newer one counts.\n\n` +
    `${entriesText(input.entries)}` +
    listed('Tracks and learning goals they already have', input.have) +
    listed('Suggestions they turned down', input.declined) +
    `\n\nCall ${TOOL_NAME}.`;

  let response;
  try {
    response = await client.messages.create({
      model: SUGGEST_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the learning tracks suggested for these career goals.',
          input_schema: {
            type: 'object',
            properties: {
              tracks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    about: { type: 'string' },
                    depth: { type: 'string', enum: Object.keys(AIM_DEPTH_LABELS) },
                    why: { type: 'string' },
                  },
                  required: ['name', 'about', 'depth', 'why'],
                },
              },
              no_data: { type: 'boolean' },
            },
            required: ['no_data'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Suggestions are rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The suggestions could not be made (${error.status}).` };
    }
    return { ok: false, error: 'The suggestions could not be made. Try again.' };
  }
  options.onSpend?.({ model: SUGGEST_MODEL, usage: usageFrom(response.usage) });

  const report = response.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
  if (!report || report.type !== 'tool_use') return { ok: false, error: 'No suggestions came back.' };

  const taken = new Set([...input.have, ...input.declined].map(trackKey));
  return parseSuggestionPayload(report.input, taken);
}
