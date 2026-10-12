import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { readFinding, type ComparedNote, type EssayCheck, type Finding, type Paragraph } from './checks';

/**
 * A model check on one part of an essay (plan #1869): one Sonnet call that
 * reports at most one problem, with the question, hint and directions for
 * the three rungs of the ladder and why it was raised.
 *
 * The system prompt never changes. The brief and the whole essay go first in
 * the user turn, marked for the cache, so the second and later paragraphs of
 * a run read them from it; the check and the paragraph follow.
 */

export const CHECK_MODEL = MODELS.learnEssayCheck;

/** Exported for the test that checks it never changes by accident. */
export const CHECK_SYSTEM = `You are Dash, reading an essay someone is writing themselves, as a demanding
first reader. You run one named check at a time on one part of the essay and
report at most one problem: the most important one that check finds there.
Most of the time there is none, and then you say so.

WHAT YOU WRITE ABOUT A PROBLEM
- quote: the exact words from the part you were given that the problem is
  about, copied character for character, one sentence or less.
- question: one question that makes the writer look again, without saying
  what is wrong. "What would someone who disagrees say here?"
- hint: one or two sentences naming the problem and where it is, without
  fixing it. "This paragraph claims X; nothing before it supports it."
- directions: two or three short ways forward, in one or two sentences, or an
  example of the same move from a different topic. Never the writer's own
  sentence rewritten.
- why: one sentence on why the check raised it, for when the writer asks.

RULES
- Plain English, British spelling, second person. No praise, no hedging.
- Never write any of the essay for them.
- Do not raise a problem the check does not ask about.

Reply with JSON only, no code fence:
{"finding": null}
or
{"finding": {"quote": "...", "question": "...", "hint": "...", "directions": "...", "why": "..."}}
For a check that compares the essay with the writer's notes, add "note": the
number of the note concerned.`;

/** The brief and the essay, which every call of a run shares. */
export function describeEssay(input: { claim: string; reader: string; doc: string }): string {
  const parts: string[] = [];
  parts.push(`The writer's claim, from their brief: ${input.claim.trim() || '(not written yet)'}`);
  parts.push(`The reader it is for, from their brief: ${input.reader.trim() || '(not written yet)'}`);
  parts.push(`<essay>\n${input.doc}\n</essay>`);
  return parts.join('\n\n');
}

/** The check, the part it reads and, for Already Said, the notes to compare with. */
export function describeTask(check: EssayCheck, unit: Paragraph | null, notes: readonly ComparedNote[]): string {
  const parts: string[] = [`Check: ${check.name}`, check.instruction];
  parts.push(unit ? `<part>\n${unit.text}\n</part>` : 'The part to check is the whole essay above.');
  if (notes.length > 0) {
    parts.push(
      notes.map((note, i) => `<note number="${i + 1}" title="${note.title}">\n${note.text}\n</note>`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

export type CheckCallResult = { ok: true; finding: Finding | null } | { ok: false; detail: string };

export async function runCheckCall(input: {
  check: EssayCheck;
  doc: string;
  unit: Paragraph | null;
  claim: string;
  reader: string;
  notes?: readonly ComparedNote[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<CheckCallResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  const notes = input.notes ?? [];
  let response;
  try {
    response = await client.messages.create({
      model: CHECK_MODEL,
      max_tokens: 700,
      system: [{ type: 'text', text: CHECK_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: describeEssay({ claim: input.claim, reader: input.reader, doc: input.doc }),
              cache_control: { type: 'ephemeral' },
            },
            { type: 'text', text: describeTask(input.check, input.unit, notes) },
          ],
        },
      ],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The check failed.' };
  }
  input.onSpend?.({ model: CHECK_MODEL, usage: usageFrom(response.usage) });
  const reply = response.content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
  return { ok: true, finding: readFinding(reply, input.doc, input.unit, notes) };
}
