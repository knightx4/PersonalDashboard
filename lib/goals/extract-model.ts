/**
 * The model call that reads pasted text or a document into a form (plan
 * #955). One call with the collection's fields as a forced tool, so the
 * answer arrives in the shape the form takes; lib/goals/extract.ts builds the
 * tool and reads the answer back.
 *
 * Haiku reads text, PDFs and images, and a statement is copying numbers off
 * a page rather than judging anything, so the larger models would cost more
 * for the same rows. A Word file arrives here as its text (lib/goals/docx.ts).
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { CollectionField, CollectionShape } from '@/lib/goals/collections';
import { EXTRACT_TOOL, extractionPrompt, extractionTool } from '@/lib/goals/extract';

export const EXTRACT_MODEL = 'claude-haiku-4-5';

/** What is read: text, or a file's bytes as base64. */
export type ExtractSource =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; data: string }
  | {
      kind: 'image';
      data: string;
      mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    };

export type ExtractModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; recorded as 'read-into-form'. */
  onSpend?: SpendSink;
};

export type ExtractResult = { ok: true; input: unknown } | { ok: false; error: string };

/** Ask; get back the tool input, or why there is none. */
export async function askExtractModel(
  options: ExtractModelOptions,
  collection: { name: string; shape: CollectionShape; fields: CollectionField[] },
  source: ExtractSource,
): Promise<ExtractResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const tool = extractionTool(collection.fields);

  const given: Anthropic.ContentBlockParam =
    source.kind === 'text'
      ? { type: 'text', text: `<pasted>\n${source.text}\n</pasted>` }
      : source.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.data } }
        : { type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.data } };

  let response;
  try {
    response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 4096,
      system: extractionPrompt(collection.name, collection.shape),
      tools: [tool as Anthropic.Tool],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL },
      messages: [
        {
          role: 'user',
          content: [given, { type: 'text', text: `Fill in the ${collection.name} form from this.` }],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Reading is rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `That could not be read (${error.status}).` };
    }
    return { ok: false, error: 'That could not be read.' };
  }
  options.onSpend?.({ model: EXTRACT_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === EXTRACT_TOOL,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}
