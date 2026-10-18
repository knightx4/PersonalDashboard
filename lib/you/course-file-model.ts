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
import { summaryTool } from '@/lib/you/course-file-read';
import { MODELS } from '@/lib/core/models';
import { forceTool } from '@/lib/learn/graph/tool-call';

export const COURSE_FILE_MODEL = MODELS.youCourseFileSummary;

/** The spend ledger's name for one read (lib/core/spend/operations.ts). */
export const COURSE_FILE_OPERATION: YouOperation = 'summarise-course-file';

/** The spend ledger's name for laying out a syllabus's weeks (plan #2401.6). */
export const SYLLABUS_WEEKS_OPERATION: YouOperation = 'read-syllabus-weeks';

export type CourseFileModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; the caller records it as COURSE_FILE_OPERATION. */
  onSpend?: SpendSink;
};

/**
 * The tool the answer comes back through and what the file is sent with.
 * Summarise's by default; laying out a syllabus's weeks (plan #2401.6,
 * lib/you/syllabus-weeks.ts) passes its own.
 */
export type CourseFileAsk = {
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  instruction: string;
  maxTokens?: number;
};

const SUMMARISE: CourseFileAsk = {
  tool: summaryTool(),
  instruction: 'Summarise this file and list the points worth keeping.',
};

/** Ask; get back the tool input, or why there is none. */
export async function askCourseFileModel(
  options: CourseFileModelOptions,
  source: ExtractSource,
  system: string,
  ask: CourseFileAsk = SUMMARISE,
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
      max_tokens: ask.maxTokens ?? 2_000,
      system,
      tools: [ask.tool as Anthropic.Tool],
      tool_choice: forceTool(ask.tool.name, COURSE_FILE_MODEL),
      messages: [
        {
          role: 'user',
          content: [given, { type: 'text', text: ask.instruction }],
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
    (block) => block.type === 'tool_use' && block.name === ask.tool.name,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back. Try again.' };
  return { ok: true, input: reported.input };
}
