/**
 * Building a request from a model's rules and reading the reply it gets
 * (plan #2937.3).
 *
 * The request side turns lib/core/model-rules.ts into the fields a call
 * sends: thinking and its display, effort, tool choice, a strict tool, and a
 * mid-conversation system message. The reply side sorts what came back into
 * one of five kinds, each with its reason in words, so a call that got no
 * report says which of the five happened instead of guessing.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { forceTool, PROGRESS_NOTES_BETA, rulesFor, takesSystemMessages, writesProgressNotes, type Effort } from '@/lib/core/model-rules';

export { forceTool };

/**
 * The thinking, effort and beta headers a request to `model` sends.
 *
 * Thinking is sent only where the model writes progress notes, asking for
 * the display that returns their summaries; elsewhere the model's own default
 * (adaptive, on every model the app calls) is left alone. Effort is sent only
 * when asked for. Both are widened: the installed SDK's types predate
 * adaptive thinking and `output_config`, so they are spread into the params.
 */
export function requestShape(
  model: string,
  effort?: Effort,
): { thinking: Record<string, never>; effort: Record<string, never>; beta: string[] } {
  const rules = rulesFor(model);
  const notes = writesProgressNotes(model);
  return {
    thinking: (notes ? { thinking: { type: 'adaptive', display: rules!.notesDisplay } } : {}) as Record<string, never>,
    effort: (effort ? { output_config: { effort } } : {}) as Record<string, never>,
    beta: notes ? [PROGRESS_NOTES_BETA] : [],
  };
}

/**
 * A tool marked strict where the model allows it, so its input always
 * matches the schema; unchanged where it does not. Widened: the installed
 * SDK's types predate `strict`.
 */
export function strictTool<T extends { name: string }>(tool: T, model: string): T {
  return rulesFor(model)?.strictTools ? ({ ...tool, strict: true } as T) : tool;
}

/**
 * An instruction added after the newest user turn: a system message where
 * the model takes one, so the cached history still reads, and otherwise the
 * same words as a user turn. Widened: the installed SDK's types predate the
 * system role inside `messages`.
 */
export function systemMessage(model: string, text: string): Anthropic.MessageParam {
  return (takesSystemMessages(model) ? { role: 'system', content: text } : { role: 'user', content: text }) as Anthropic.MessageParam;
}

/** What a reply turned out to be. */
export type ReplyKind =
  /** It called the tool it was asked to report through. */
  | 'tool'
  /** It wrote text and called no such tool. */
  | 'text'
  /** It ended its turn with no tool call and no text: what it wrote, if anything, stayed in thinking. */
  | 'hidden'
  /** It reached `max_tokens` before it finished. */
  | 'cut_off'
  /** A safety classifier declined it (`stop_reason: "refusal"`). */
  | 'refused';

export type ReplyRead = { kind: ReplyKind; reason: string };

type Reply = {
  content: ReadonlyArray<{ type: string; name?: string; text?: string; thinking?: unknown }>;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
};

/**
 * Which of the five kinds a reply is, with the reason in one sentence a
 * person can act on. `tool` names the tool the call asked for; without it the
 * reply is read as one already known to lack that call. `model`, when given, says whether an empty reply
 * is the model writing out of sight.
 *
 * `max_tokens` is called out by name because it is the failure that looks
 * like a model problem and is a budget problem: the same section succeeds
 * with a larger one, and nothing about the prompt needs touching.
 */
export function readReply(reply: Reply, tool?: string, model?: string): ReplyRead {
  const stopped = reply.stop_reason ?? 'unknown';
  if (tool !== undefined && reply.content.some((part) => part.type === 'tool_use' && part.name === tool)) {
    return { kind: 'tool', reason: `The call reported through ${tool}.` };
  }
  if (reply.stop_reason === 'max_tokens') {
    return { kind: 'cut_off', reason: 'The reply was cut off before it finished reporting. The section is too long for the budget.' };
  }
  if (reply.stop_reason === 'refusal') {
    const category = reply.stop_details?.category;
    const explanation = reply.stop_details?.explanation?.trim();
    return {
      kind: 'refused',
      reason: `The model declined to answer${category ? ` (${category})` : ''}.${explanation ? ` ${explanation}` : ''}`,
    };
  }
  if (reply.content.some((part) => part.type === 'text' && (part.text === undefined || part.text.trim() !== ''))) {
    return { kind: 'text', reason: `The call answered in prose instead of reporting (stopped: ${stopped}).` };
  }
  const thought = reply.content.some((part) => part.type === 'thinking');
  const outOfSight = thought && (model === undefined || writesProgressNotes(model));
  return {
    kind: 'hidden',
    reason: outOfSight
      ? `The call ran but reported nothing: what it wrote came back as a progress note in a thinking block, out of sight (stopped: ${stopped}).`
      : `The call ran but reported nothing (stopped: ${stopped}).`,
  };
}
