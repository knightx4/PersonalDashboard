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
 * What makes it worth having at all is the citation. Every sentence traces to
 * an item you wrote, the model reports what it could not ground, and an empty
 * evidence set is an error rather than an empty-context fallback — otherwise
 * this is a blank page with extra steps, which is the thing a chat window
 * already does.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { parseDraftPayload, type DraftResult } from './draft-payload';
import type { ShortlistItem } from './shortlist';

/** Writing in someone else's voice off their own material. Judgment again. */
const MODEL = 'claude-opus-5';
const TOOL_NAME = 'report_draft';

const SYSTEM = `You draft an application answer for someone, out of their own
evidence bank, in their own voice.

You are given their evidence bank, then one question and the role it is being
asked for. Write the answer they would write if they had an hour, and report:
- answer: the draft itself. Plain prose, first person, no headings and no
  bullet list unless the question asks for one.
- evidence_item_ids: every bank item the answer draws on, copied exactly.
- unsupported_claims: any factual claim in your answer that is not carried by
  one of those items — a number, a scale, a timeline, a job title, a result.

Rules:

Every sentence of substance must trace to an item. You are arranging their
material for this question, not adding to it. Where a question needs a detail
the bank does not have, either leave it out or write the sentence without it —
and if you do state something the bank does not carry, it goes in
unsupported_claims verbatim, as it appears in your answer. Reporting a claim
there is not a failure; hiding one is.

Their words, not yours. Reuse the vocabulary and the sentence rhythm of the
items you are citing. A draft that reads better than the person writes is a
draft they have to rewrite.

Answer the question that was asked. A behavioural question wants one story
told properly, not four listed. Respect the word limit if one is given — go
under it rather than over.

No throat-clearing. Do not open by restating the question, do not tell the
employer what an exciting opportunity this is, and do not close with a
paragraph about your enthusiasm.

If the bank genuinely does not cover the question, say so in unsupported_claims
and write the shortest honest answer you can from what is there. Do not
manufacture a story.`;

export type DraftInput = {
  question: string;
  /** Title and company, so the answer can be about this role. */
  roleLabel: string;
  /** The shortlist for this question. Empty is refused upstream. */
  bank: readonly ShortlistItem[];
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
  if (input.bank.length === 0) {
    return {
      ok: false,
      error: 'Your evidence bank is empty, so there is nothing to write from.',
    };
  }

  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const context = [
    `Role: ${input.roleLabel}`,
    input.requirementSummary ? `What the role asks for: ${input.requirementSummary}` : null,
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
      max_tokens: 4096,
      // Same prefix as the match: the bank is identical across every question
      // and every role, so it is cached and the question goes last.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: `The evidence bank:\n\n${renderBank(input.bank)}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the draft, what it cites, and what it could not ground.',
          input_schema: {
            type: 'object',
            properties: {
              answer: { type: 'string' },
              evidence_item_ids: { type: 'array', items: { type: 'string' } },
              unsupported_claims: { type: 'array', items: { type: 'string' } },
            },
            required: ['answer', 'evidence_item_ids', 'unsupported_claims'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
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
