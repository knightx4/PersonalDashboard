/**
 * The model call that reads the jobs off a résumé (plan #1991.4). One call
 * with the job list as a forced tool, on the résumé's text, made the way the
 * transcript reader makes its call (lib/you/transcript-model.ts).
 *
 * Haiku: listing jobs is copying rows off a page, and what it gets wrong you
 * correct on the tab.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { LearnOperation } from '@/lib/learn/spend';
import {
  WORK_HISTORY_TOOL,
  workHistoryPrompt,
  workHistoryTool,
  type WorkHistoryAnswer,
} from '@/lib/you/work-history-read';

export const WORK_HISTORY_MODEL = MODELS.youWorkHistory;

/** The spend ledger's name for one read (lib/learn/spend.ts, beside the transcript's). */
export const WORK_HISTORY_OPERATION: LearnOperation = 'read-work-history';

export type WorkHistoryModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; the caller records it as WORK_HISTORY_OPERATION. */
  onSpend?: SpendSink;
};

/** Ask; get back the tool input, or why there is none. */
export async function askWorkHistoryModel(options: WorkHistoryModelOptions, text: string): Promise<WorkHistoryAnswer> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  let response;
  try {
    response = await client.messages.create({
      model: WORK_HISTORY_MODEL,
      max_tokens: 4_000,
      system: workHistoryPrompt(),
      tools: [workHistoryTool() as Anthropic.Tool],
      tool_choice: forceTool(WORK_HISTORY_TOOL, WORK_HISTORY_MODEL),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `<resume>\n${text}\n</resume>` },
            { type: 'text', text: 'List the jobs on this résumé.' },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Reading is rate-limited right now. Try again in a minute.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Your résumé could not be read (${error.status}).` };
    }
    return { ok: false, error: 'Your résumé could not be read.' };
  }
  options.onSpend?.({ model: WORK_HISTORY_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find((block) => block.type === 'tool_use' && block.name === WORK_HISTORY_TOOL);
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}
