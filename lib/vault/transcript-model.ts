/**
 * The model call that reads the courses off a transcript (plan #1307). One
 * call with the course list as a forced tool, made the same way the goals
 * reader sends a document (lib/goals/extract-model.ts): a PDF as a document
 * block, a photo as an image block, a Word file or pasted text as text.
 * lib/vault/transcript-read.ts builds the tool and reads the answer back.
 *
 * Haiku, as for the goals reader: listing courses is copying rows off a page
 * rather than judging anything, and it reads scans and photos. What it gets
 * wrong you correct before saving.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import type { LearnOperation } from '@/lib/learn/spend';
import { TRANSCRIPT_TOOL, transcriptPrompt, transcriptTool } from '@/lib/vault/transcript-read';

export const TRANSCRIPT_MODEL = 'claude-haiku-4-5';

/** The spend ledger's name for one read (lib/learn/spend.ts, where the vault's operations live). */
export const TRANSCRIPT_OPERATION: LearnOperation = 'read-transcript';

export type TranscriptModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; the caller records it as TRANSCRIPT_OPERATION. */
  onSpend?: SpendSink;
};

/** Ask; get back the tool input, or why there is none. */
export async function askTranscriptModel(
  options: TranscriptModelOptions,
  source: ExtractSource,
): Promise<ExtractResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const given: Anthropic.ContentBlockParam =
    source.kind === 'text'
      ? { type: 'text', text: `<transcript>\n${source.text}\n</transcript>` }
      : source.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.data } }
        : { type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.data } };

  let response;
  try {
    response = await client.messages.create({
      model: TRANSCRIPT_MODEL,
      max_tokens: 16_000,
      system: transcriptPrompt(),
      tools: [transcriptTool() as Anthropic.Tool],
      tool_choice: { type: 'tool', name: TRANSCRIPT_TOOL },
      messages: [
        {
          role: 'user',
          content: [given, { type: 'text', text: 'List the courses on this transcript.' }],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Reading is rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `That transcript could not be read (${error.status}).` };
    }
    return { ok: false, error: 'That transcript could not be read.' };
  }
  options.onSpend?.({ model: TRANSCRIPT_MODEL, usage: usageFrom(response.usage) });

  if (response.stop_reason === 'max_tokens') {
    return {
      ok: false,
      error: 'That transcript is too long to read in one go. Try it a few pages at a time.',
    };
  }
  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TRANSCRIPT_TOOL,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}
