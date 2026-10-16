import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { COURSE_DEPTHS, TOPICS_PER_COURSE, type Candidate, type CourseDepth } from './course-bands';

/**
 * The call naming the frame topics one graded course covered, and how deep
 * the course went (plan #2172.4.1). Haiku: it picks from a short list and
 * judges a course level from a code and a title, which needs no field
 * expertise. The rules for what the reply becomes are in ./course-bands.
 */

export const COURSE_TOPICS_MODEL = MODELS.learnCourseTopics;
const TOOL = 'report_course_topics';

const SYSTEM = `You read one course from a university transcript and say which encyclopedia topics it taught and how deep it went.

TOPICS. You are given a list of candidate topics (T1, T2, ...), the general
encyclopedia topics nearest the course. Pick the ones the course taught as
real content: a topic a student who passed it would have studied, not one it
merely touched or that only shares words with its title. A course on Private
Equity teaches Investment and Debt; it does not teach Curriculum or
University. Pick at most ${TOPICS_PER_COURSE}, the most central first. If a central
topic of the course is missing from the list, you may name up to three more
by their exact encyclopedia article title in "others". Pick none rather than
guess when the course is too vague to say.

DEPTH.
- intro: a first course in the subject, with no prerequisite in it. Course
  numbers 100 to 199 or 1000 to 1999 are usually this, as are AP credits.
- intermediate: builds on an introduction. Numbers 200 to 399 or 2000 to 3999.
- advanced: upper-division specialised courses, numbers 400 and up or 4000 and
  up, and every graduate or professional course (an MBA, law or master's).

Call ${TOOL} once.`;

const replySchema = z.object({
  depth: z.enum(COURSE_DEPTHS),
  picks: z.array(z.string()).default([]),
  others: z.array(z.string()).default([]),
});

export type CourseTopicsReply = { depth: CourseDepth; picks: string[]; others: string[] };
export type CourseTopicsResult = { ok: true; reply: CourseTopicsReply } | { ok: false; detail: string };

/** The prompt: what the course is known by, then the shortlist. */
export function courseTopicsPrompt(text: string, candidates: readonly Candidate[]): string {
  const lines = [text, '', 'Candidate topics:'];
  candidates.forEach((c, i) => lines.push(`T${i + 1}: ${c.title}`));
  lines.push('', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** Name one course's topics. Never throws. */
export async function nameCourseTopicsCall(input: {
  text: string;
  candidates: readonly Candidate[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<CourseTopicsResult> {
  const model = COURSE_TOPICS_MODEL;
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 400,
      system: SYSTEM,
      tools: [
        {
          name: TOOL,
          description: 'Report the course depth and the topics it taught.',
          input_schema: {
            type: 'object',
            properties: {
              depth: { type: 'string', enum: [...COURSE_DEPTHS] },
              picks: {
                type: 'array',
                items: { type: 'string', description: 'A candidate key, such as T3.' },
                description: `The candidate topics the course taught, most central first, at most ${TOPICS_PER_COURSE}.`,
              },
              others: {
                type: 'array',
                items: { type: 'string' },
                description: 'Up to three central topics missing from the list, by exact encyclopedia article title.',
              },
            },
            required: ['depth', 'picks'],
          },
        },
      ],
      tool_choice: forceTool(TOOL, model),
      messages: [{ role: 'user', content: courseTopicsPrompt(input.text, input.candidates) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Naming the course topics failed.' };
  }

  input.onSpend?.({ model, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const parsed = replySchema.safeParse(block.input);
  if (!parsed.success) return { ok: false, detail: 'The course topics came back malformed.' };
  return { ok: true, reply: { depth: parsed.data.depth, picks: parsed.data.picks, others: parsed.data.others.slice(0, 3) } };
}
