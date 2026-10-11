import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { CLIP_MODEL, matchServes } from './clips';

/**
 * Tagging clips already cut with the subjects they serve (plan #1696, under
 * #1694).
 *
 * Clips cut before #1695 carry one subject at most. This reads a batch of
 * them by caption and idea alone, with the person's subject names, and asks
 * Haiku which subjects each one serves. No transcript is fetched. Names are
 * matched back to subjects the way the cutter's are (matchServes), so a name
 * that is not one of the person's subjects tags nothing.
 *
 * The call is here and the database is in clip-tag-run.ts.
 */

export const TAG_MODEL = CLIP_MODEL;

/** Clips sent in one call. */
export const TAG_BATCH = 50;

const CAPTION_CHARS = 300;
const IDEA_CHARS = 600;

/** A clip as the call reads it. */
export type ClipToTag = { id: string; caption: string; idea: string | null };

/** A subject as the call reads it: a learn.subjects row that is not a survey. */
export type SubjectToTag = { id: string; name: string; note: string | null };

const TAG_TOOL = 'report_clip_subjects';

const TAG_SYSTEM = `You sort short video clips by the subjects a person is studying. Each clip
is given by its number, its caption and the point it makes. You are given the
person's subjects by name.

For each clip, name every subject it serves: the clip teaches something that
belongs to that subject, or that someone studying it would want to know. A
clip can serve several subjects, or none. Do not stretch: a clip about
general productivity does not serve a finance subject because finance people
are busy.

Copy each subject name exactly as given. Report every clip, with an empty
list when it serves none.`;

function tidy(text: string | null | undefined, limit: number): string {
  const plain = (text ?? '').replace(/\s+/g, ' ').trim();
  return plain.length <= limit ? plain : `${plain.slice(0, limit - 1).trimEnd()}…`;
}

export function tagPrompt(subjects: readonly SubjectToTag[], clips: readonly ClipToTag[]): string {
  const lines = ['SUBJECTS:'];
  for (const subject of subjects) {
    const note = tidy(subject.note, 200);
    lines.push(note ? `- ${subject.name} (${note})` : `- ${subject.name}`);
  }
  lines.push('', 'CLIPS:');
  clips.forEach((clip, index) => {
    const idea = tidy(clip.idea, IDEA_CHARS);
    lines.push(`[${index + 1}] ${tidy(clip.caption, CAPTION_CHARS)}${idea ? `. Point: ${idea}` : ''}`);
  });
  lines.push('', `Call ${TAG_TOOL}.`);
  return lines.join('\n');
}

const tagReplySchema = z.object({
  clips: z
    .array(
      z.object({
        clip: z.coerce.number(),
        subjects: z.union([z.array(z.string()), z.string()]).optional().nullable(),
      }),
    )
    .default([]),
});

/**
 * The reply, as the subject ids each clip serves, keyed by clip id. A clip
 * the reply leaves out, or names by a number that is not in the batch, is
 * read as serving nothing. Null when the reply is not the tool's shape.
 */
export function readTagReply(
  input: unknown,
  clips: readonly ClipToTag[],
  subjects: readonly SubjectToTag[],
): Map<string, string[]> | null {
  const parsed = tagReplySchema.safeParse(input);
  if (!parsed.success) return null;
  const profile = { tracks: subjects.map((s) => ({ id: s.id, name: s.name, note: null, frontier: [], settled: 0 })), goals: [], ideas: [] };
  const out = new Map<string, string[]>(clips.map((clip) => [clip.id, []]));
  for (const row of parsed.data.clips) {
    const clip = clips[Math.round(row.clip) - 1];
    if (!clip) continue;
    const ids = out.get(clip.id)!;
    for (const id of matchServes(row.subjects ?? null, profile).subjectIds) if (!ids.includes(id)) ids.push(id);
  }
  return out;
}

export type TagResult =
  | { outcome: 'tagged'; subjects: Map<string, string[]> }
  /** The call came back but could not be read, or failed. Nothing is written, so the next run tries again. */
  | { outcome: 'failed'; detail: string };

/** Tag one batch. Never throws. */
export async function tagClipBatch(input: {
  subjects: readonly SubjectToTag[];
  clips: readonly ClipToTag[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** Milliseconds the call may take before it is abandoned. */
  timeoutMs?: number;
}): Promise<TagResult> {
  if (input.clips.length === 0 || input.subjects.length === 0) {
    return { outcome: 'tagged', subjects: new Map(input.clips.map((clip) => [clip.id, []])) };
  }
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create(
      {
        model: TAG_MODEL,
        max_tokens: 4000,
        system: TAG_SYSTEM,
        tools: [
          {
            name: TAG_TOOL,
            description: 'Report the subjects each clip serves.',
            input_schema: {
              type: 'object',
              properties: {
                clips: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      clip: { type: 'integer', description: 'The number of the clip.' },
                      subjects: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Every subject it serves, names copied exactly from the list.',
                      },
                    },
                    required: ['clip', 'subjects'],
                  },
                },
              },
              required: ['clips'],
            },
          },
        ],
        tool_choice: forceTool(TAG_TOOL, TAG_MODEL),
        messages: [{ role: 'user', content: tagPrompt(input.subjects, input.clips) }],
      },
      input.timeoutMs !== undefined ? { timeout: Math.max(1_000, input.timeoutMs), maxRetries: 0 } : undefined,
    );
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Tagging the clips failed.' };
  }
  input.onSpend?.({ model: TAG_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TAG_TOOL);
  if (!block || block.type !== 'tool_use') return { outcome: 'failed', detail: whyNoReport(response) };
  const subjects = readTagReply(block.input, input.clips, input.subjects);
  return subjects ? { outcome: 'tagged', subjects } : { outcome: 'failed', detail: 'The tags came back malformed.' };
}
