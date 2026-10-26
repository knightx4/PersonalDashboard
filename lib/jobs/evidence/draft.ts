/**
 * An answer, drafted from the bank and cited.
 *
 * The rule this inherits from lib/jobs/followup/compose.ts is not about
 * templates versus models — it is about whose name the text goes out under.
 * The template there is deterministic because a follow-up email leaves
 * immediately; a draft here can be a model call because it lands beside the
 * textarea rather than in it, and nothing reaches an employer that the person
 * did not put there themselves.
 *
 * It aims at the best answer to the question, not a rearrangement of the
 * bank: the bank supplies the facts about the person, the posting supplies
 * why this company and role, and the model reports any claim about the
 * person the bank does not carry (note ad554975, which found answers drawn
 * only from evidence never said why this company or why they fit).
 *
 * The model first works out how to approach the question (what it tests,
 * what to lead with, what the bank lacks) and writes the answer from that.
 * Those considerations replace the old list of unsupported claims on the
 * card: a gap in the bank is one of them, said as what to add.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { parseDraftPayload, type DraftResult } from './draft-payload';
import type { ShortlistItem } from './shortlist';
import { MODELS } from '@/lib/core/models';
import { THINKING_ROOM, forceTool } from '@/lib/learn/graph/tool-call';
import { PLAIN_VOICE } from '@/lib/jobs/drafting/plain-voice';

/** Writing in someone else's voice off their own material. Judgment again. */
const MODEL = MODELS.jobsEvidenceDraft;
const TOOL_NAME = 'report_draft';
/** How much of a posting is sent: the part that says what the role is. */
const POSTING_CHARS = 8000;

const SYSTEM = `You write the best answer you can to one application question,
for one person, in their voice. They will paste it into the form themselves.

You are given their evidence bank (stories and results they wrote), then the
role, what it asks for, the posting where there is one, and the question.

What a good answer does:
- Answers the question that was asked, directly, in the first sentence or two.
  A "why us" question says why this company and why this role, using what the
  posting says, and why they fit, using their own stories. A behavioural
  question tells one story properly, not four listed.
- Sounds like a capable person talking plainly: first person, short
  sentences, concrete nouns, no corporate filler. Follow the voice rules
  below and how they write.
- Uses their evidence where it carries the point: a real result, a real
  situation, their own words and numbers. Pick the one or two items that fit
  best and leave the rest. The bank is material to draw on, not a limit on
  what the answer may say.
- Stays under the word limit if one is given.

Before you write, work out how to approach this question, and write the
answer from that. These considerations are shown to the person beside the
answer, so write them to them, one short plain sentence each, two to four in
all:
- What the question is really testing, and what a strong answer leads with.
- Which of their stories or results fits best and why, or what angle on the
  company or role from the posting to take.
- Any limit, and what that means for how much fits.
- Anything the question asks for that the bank does not hold (a headcount, a
  date, a reason only they know): say what to add, and leave it out of the
  answer rather than guess it.

${PLAIN_VOICE}

What it never does:
- Invent facts about them. A number, a scale, a timeline, a job title, an
  employer or a result about the person comes from the bank or is not stated.
  Where the question needs one the bank does not carry, the considerations
  say so. What you say about the company or the role from the posting is not
  a claim about them.
- Open by restating the question, call the role an exciting opportunity, or
  close with a paragraph of enthusiasm.

Report:
- considerations: as above.
- answer: the answer itself, following the considerations. Plain prose, no
  headings, no bullet list unless the question asks for one.
- evidence_item_ids: every bank item the answer draws on, copied exactly. Empty
  when it draws on none.`;

export type DraftInput = {
  question: string;
  /** Title and company, so the answer can be about this role. */
  roleLabel: string;
  /** The shortlist for this question. May be empty. */
  bank: readonly ShortlistItem[];
  /** The posting's text, cut to a length worth sending. */
  posting?: string | null;
  wordLimit?: number | null;
  /** `profiles.writing_style_notes`. */
  styleNotes?: string | null;
  /** `profiles.banned_constructions`, checked against the output afterwards. */
  banned?: readonly string[];
  /** The approved answer to this question elsewhere, if there is one. */
  canonicalAnswer?: string | null;
  /** What the requirement match said this role wants, when it has been run. */
  requirementSummary?: string | null;
};

export type DraftOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'draft-answer'. */
  onSpend?: SpendSink;
};

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

export async function draftAnswer(
  options: DraftOptions,
  input: DraftInput,
): Promise<DraftResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const context = [
    `Role: ${input.roleLabel}`,
    input.requirementSummary ? `What the role asks for: ${input.requirementSummary}` : null,
    input.posting?.trim() ? `The posting:\n${input.posting.trim().slice(0, POSTING_CHARS)}` : null,
    input.wordLimit ? `Word limit: ${input.wordLimit}` : null,
    input.styleNotes?.trim() ? `How they write:\n${input.styleNotes.trim()}` : null,
    input.canonicalAnswer?.trim()
      ? `Their approved answer to this question elsewhere, to tailor rather than replace:\n${input.canonicalAnswer.trim()}`
      : null,
    `Question: ${input.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096 + THINKING_ROOM,
      // Same prefix as the match: the bank is identical across every question
      // and every role, so it is cached and the question goes last.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: input.bank.length
            ? `The evidence bank:\n\n${renderBank(input.bank)}`
            : 'The evidence bank is empty, so say nothing about them that is not general.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report how to approach the question, the draft written from that, and what it cites.',
          input_schema: {
            type: 'object',
            // Considerations first, so they are written before the answer.
            properties: {
              considerations: { type: 'array', items: { type: 'string' } },
              answer: { type: 'string' },
              evidence_item_ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['considerations', 'answer', 'evidence_item_ids'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, MODEL),
      messages: [{ role: 'user', content: `${context}\n\nCall ${TOOL_NAME}.` }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Drafting is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Draft failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Draft failed.' };
  }
  options.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const report = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!report || report.type !== 'tool_use') {
    return { ok: false, error: 'No draft came back.' };
  }

  return parseDraftPayload(
    report.input,
    input.bank.map((item) => item.id),
    input.banned ?? [],
  );
}
