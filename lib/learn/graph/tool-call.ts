/**
 * Getting the tool block out of a reply, and saying why there isn't one.
 *
 * Every call in this module asks the model to report through a tool and then
 * looks for that block in the reply. None of them forced the tool, so the
 * model was free to answer in prose instead -- which it does on a note whose
 * content is mostly formulas, and which every one of them reported as "the
 * call ran but reported nothing". Reading a note deriving the Kelly criterion
 * hit exactly that.
 *
 * Forcing the tool is the fix where the model allows it (`forceTool`). This
 * module holds the reason a block is still missing after it, because the two remaining causes need different responses and used
 * to read identically: a reply cut off at `max_tokens` needs a bigger budget
 * or a smaller section, and a reply that stopped normally with no tool call
 * needs a prompt that asks for one.
 */

import { HAIKU } from '@/lib/core/models';

/**
 * Given to `tool_choice` so the model reports through the tool.
 *
 * Forced where the model allows it. Opus 5.5 and Sonnet 5.5 reject a forced
 * tool with a 400, so for them the choice is left to the model and the prompt
 * asks for the tool by name; `whyNoReport` below covers the reply that answers
 * in prose instead.
 */
export function forceTool(
  name: string,
  model: string,
): { type: 'tool'; name: string } | { type: 'auto' } {
  return FORCEABLE.has(model) ? { type: 'tool', name } : { type: 'auto' };
}

/** The models that accept a forced tool. */
const FORCEABLE: ReadonlySet<string> = new Set([HAIKU]);

/**
 * Added to `max_tokens` where the tool is not forced. A model left to choose
 * thinks before it reports, and the thinking counts towards `max_tokens`, so a
 * budget sized for the report alone cuts the report off.
 */
export const THINKING_ROOM = 8_000;

type Reply = {
  content: Array<{ type: string; name?: string }>;
  stop_reason?: string | null;
};

/** The tool block, or null when the model did not produce one. */
export function toolBlockIn<T extends Reply>(reply: T, name: string): T['content'][number] | null {
  const block = reply.content.find((part) => part.type === 'tool_use' && part.name === name);
  return block ?? null;
}

/**
 * Why there is no tool block, in one sentence a person can act on.
 *
 * `max_tokens` is called out by name because it is the failure that looks like
 * a model problem and is a budget problem: the same section succeeds with a
 * larger one, and nothing about the prompt needs touching.
 */
export function whyNoReport(reply: Reply): string {
  if (reply.stop_reason === 'max_tokens') {
    return 'The reply was cut off before it finished reporting. The section is too long for the budget.';
  }

  const text = reply.content.find((part) => part.type === 'text');
  if (text) {
    return `The call answered in prose instead of reporting (stopped: ${reply.stop_reason ?? 'unknown'}).`;
  }

  return `The call ran but reported nothing (stopped: ${reply.stop_reason ?? 'unknown'}).`;
}
