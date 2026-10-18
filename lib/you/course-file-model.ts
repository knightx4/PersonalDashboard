/**
 * The model call behind Summarise on a course file (plan #2401.4). One call
 * with the summary as a forced tool, sending the file the way the transcript
 * reader does (lib/you/transcript-model.ts): a PDF as a document block, a
 * photo as an image block, anything else as its text.
 * lib/you/course-file-read.ts builds the tool and reads the answer back.
 *
 * Haiku: it reads PDFs, scans and photos, and a lecture's summary and points
 * do not need the larger models, while a file can run to a hundred pages and
 * the press is paid for each time.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { ExtractResult, ExtractSource } from '@/lib/goals/extract-model';
import type { YouOperation } from '@/lib/core/spend/operations';
import { SUMMARY_TOOL, summaryTool } from '@/lib/you/course-file-read';
import { MODELS } from '@/lib/core/models';
import { forceTool } from '@/lib/learn/graph/tool-call';

export const COURSE_FILE_MODEL = MODELS.youCourseFileSummary;

/** The spend ledger's name for one read (lib/core/spend/operations.ts). */
export const COURSE_FILE_OPERATION: YouOperation = 'summarise-course-file';

export type CourseFileModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; the caller records it as COURSE_FILE_OPERATION. */
  onSpend?: SpendSink;
};

/** Ask; get back the tool input, or why there is none. */
export async function askCourseFileModel(
  options: CourseFileModelOptions,
  source: ExtractSource,
  system: string,
): Promise<ExtractResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const given: Anthropic.ContentBlockParam =
    source.kind === 'text'
      ? { type: 'text', text: `<file>\n${source.text}\n</file>` }
      : source.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.data } }
        : { type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.data } };

  let response;
  try {
    response = await client.messages.create({
      model: COURSE_FILE_MODEL,
      max_tokens: 2_000,
      system,
      tools: [summaryTool() as Anthropic.Tool],
      tool_choice: forceTool(SUMMARY_TOOL, COURSE_FILE_MODEL),
      messages: [
        {
          role: 'user',
          content: [given, { type: 'text', text: 'Summarise this file and list the points worth keeping.' }],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Reading is rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError && (error.status === 400 || error.status === 413)) {
      return {
        ok: false,
        error: 'That file could not be read. It may be damaged, or longer than the 100 pages one read can take.',
      };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `That file could not be read (${error.status}). Try again.` };
    }
    return { ok: false, error: 'That file could not be read. Try again.' };
  }
  options.onSpend?.({ model: COURSE_FILE_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === SUMMARY_TOOL,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back. Try again.' };
  return { ok: true, input: reported.input };
}
