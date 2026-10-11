import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';

/**
 * "In this video" on a Learn now card (note cde86a10): what the lecture clip
 * on the card says, and why it is there.
 *
 * A card is given the YouTube segment nearest its idea when it is dealt
 * (load.ts, withVideos). The segment is raw transcript, so one Haiku call
 * reads it beside the card's idea and writes a sentence for each. The hourly
 * top-up makes the call (clip-note-run.ts), so the card never waits on it.
 */

export const CLIP_NOTE_MODEL = MODELS.learnClipNote;
const TOOL_NAME = 'describe_clip';

/** Transcript past this is left out: a segment runs about four and a half minutes. */
export const MAX_CLIP_TEXT = 6_000;
/** Longer than this and a sentence became a paragraph; it is cut at a sentence. */
export const MAX_SENTENCE = 300;

export type ClipNote = { said: string; why: string };

export type ClipNoteInput = {
  /** The card's idea, as its title reads. */
  idea: string;
  /** The card's takeaway or summary, for what the idea claims. */
  claim: string;
  /** The video's title. */
  video: string;
  /** The segment's transcript. */
  text: string;
};

const SYSTEM = `You are Dash. A card in somebody's learning feed is about one idea, and a stretch of a lecture video plays on it. Its transcript is below, beside the card's idea.

Write two sentences.
said: what the speaker says in this stretch, in everyday words, naming the subject itself. Start with the speaker's point, never with "The speaker", "This clip" or "In this video".
why: how this stretch bears on the card's idea, naming the idea, so somebody can decide whether to watch it. When it only touches the idea, say what it adds.

Plain prose, one sentence each, under thirty words each. No dashes used for rhythm and no "not X, but Y" contrasts. Report through ${TOOL_NAME}.`;

/** The user message: the card's idea, then the clip. Exported for the test. */
export function clipNotePrompt(input: ClipNoteInput): string {
  return [
    `The card's idea: ${input.idea.trim()}`,
    input.claim.trim() ? `What the card says about it: ${input.claim.trim()}` : null,
    '',
    `The video: ${input.video.trim()}`,
    'The transcript of the stretch on the card:',
    input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CLIP_TEXT),
    '',
    `Call ${TOOL_NAME}.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

const payloadSchema = z.object({ said: z.string(), why: z.string() });

/** Cut at the last sentence end within `limit`, or at the limit when there is none. */
function cutAtSentence(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const end = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
  return end > limit / 3 ? window.slice(0, end + 1) : window.trimEnd();
}

/** Read the tool payload, or say why it could not be. Pure; exported for the test. */
export function readClipNote(input: unknown): ClipNote | string {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return 'The note did not match its schema.';
  const said = cutAtSentence(parsed.data.said.replace(/\s+/g, ' ').trim(), MAX_SENTENCE);
  const why = cutAtSentence(parsed.data.why.replace(/\s+/g, ' ').trim(), MAX_SENTENCE);
  if (!said || !why) return 'The note came back empty.';
  return { said, why };
}

export type ClipNoteResult = ({ ok: true } & ClipNote) | { ok: false; detail: string };

/** Describe one clip against one card. Never throws. */
export async function writeClipNote(
  input: ClipNoteInput & { anthropicApiKey: string; client?: Anthropic; onSpend?: SpendSink },
): Promise<ClipNoteResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: CLIP_NOTE_MODEL,
      max_tokens: 400,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Say what the clip says and why it fits the card.',
          input_schema: {
            type: 'object',
            properties: {
              said: { type: 'string', description: 'What the speaker says, in one sentence.' },
              why: { type: 'string', description: "Why it bears on the card's idea, in one sentence." },
            },
            required: ['said', 'why'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, CLIP_NOTE_MODEL),
      messages: [{ role: 'user', content: clipNotePrompt(input) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Describing the clip failed.' };
  }

  input.onSpend?.({ model: CLIP_NOTE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const read = readClipNote(block.input);
  if (typeof read === 'string') return { ok: false, detail: read };
  return { ok: true, ...read };
}
