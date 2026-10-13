import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { describeBrief, usableAsk } from './interview';
import type { BriefField, EssayBrief } from './model';

/**
 * The wording of the interview's next question (plan #1867): one Sonnet call
 * per answer.
 *
 * The kind of question is fixed by the spec; Dash only words it so it follows
 * on from what the person just said, the way an interviewer asks one
 * follow-up rather than reading out a form. The system prompt never changes
 * from one call to the next, byte for byte, so it can be cached; everything
 * about this essay goes in the user turn.
 */

const MODEL = MODELS.learnEssayInterview;

/** Exported for the test that checks it never changes by accident. */
export const INTERVIEW_SYSTEM = `You are Dash, interviewing someone for a few minutes before they write a short
essay of their own. Your questions help them find what they think. You do not
write any of the essay and you do not answer for them.

You are told what they started the essay from, their answers so far, and the
kind of question to ask next. Ask that one question.

HOW TO ASK
- One question, one sentence, under 30 words, ending with a question mark.
- Build it on their own words: pick up a phrase they used, a gap between two
  answers, or the thing they started from. A question that could be asked of
  anyone is a wasted turn.
- Keep the kind you were given. If you are told to ask who the essay is for,
  ask that, not something else that seems more interesting.
- Plain English, British spelling.

NEVER
- Praise or react: no "great", "interesting", "that sounds", "thanks", no
  exclamation marks.
- Summarise or repeat back what they said.
- Suggest an answer, give advice, or say what the essay should argue.
- Ask two questions, or join two with "and".

Reply with the question alone, with no quotation marks and nothing before or
after it.`;

export type AskResult = { ok: true; ask: string } | { ok: false; detail: string };

/**
 * Dash's wording of the next question, or why there is none. Pure apart from
 * the model call, so it can be tested with a stub client. A reply that breaks
 * the rules (`usableAsk`) is not used, and the caller asks the spec's
 * question in its place.
 */
export async function askNextQuestion(input: {
  brief: EssayBrief;
  field: BriefField;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<AskResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: [{ type: 'text', text: INTERVIEW_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: describeBrief(input.brief, input.field) }],
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Asking failed.' };
  }
  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const text = response.content
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ');
  const ask = usableAsk(text);
  return ask ? { ok: true, ask } : { ok: false, detail: 'The question came back in a form the interview does not use.' };
}
