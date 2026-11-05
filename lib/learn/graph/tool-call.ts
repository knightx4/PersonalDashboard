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

import { readReply } from '@/lib/core/model-call';

/*
 * Which models take a forced tool and which write progress notes are rules
 * of the model, kept in lib/core/model-rules.ts with every other (plan
 * #2937.3). They are passed on from here for the calls that already import
 * them from this file.
 */
export { forceTool, PROGRESS_NOTES_BETA, writesProgressNotes } from '@/lib/core/model-rules';

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
 * Why there is no tool block, in one sentence a person can act on: the
 * reason `readReply` (lib/core/model-call.ts) gives for a reply cut off,
 * refused, answered in prose, or with nothing to show.
 */
export function whyNoReport(reply: Reply): string {
  return readReply(reply).reason;
}
