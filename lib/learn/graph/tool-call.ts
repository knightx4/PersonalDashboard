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
 * `FORCE` is the fix. This module holds the reason a block is still missing
 * after it, because the two remaining causes need different responses and used
 * to read identically: a reply cut off at `max_tokens` needs a bigger budget
 * or a smaller section, and a reply that stopped normally with no tool call
 * needs a prompt that asks for one.
 */

/** Given to `tool_choice` so the model has to report through the tool. */
export function forceTool(name: string): { type: 'tool'; name: string } {
  return { type: 'tool', name };
}

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
