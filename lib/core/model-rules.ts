/**
 * What each Claude model the app calls allows, in one place (plan #2937.3).
 *
 * A model change used to mean finding every list that named the old model:
 * which models take a forced tool lived in lib/learn/graph/tool-call.ts,
 * which write progress notes lived beside it, and runDash had its own guesses.
 * Now every id in lib/core/models.ts has one entry here, `MODEL_RULES` is
 * typed so an id without one does not compile, and lib/core/models.test.ts
 * fails when a `MODELS` entry has none. lib/core/model-call.ts builds
 * requests and reads replies from these rules.
 *
 * Source for every entry: the claude-api skill's model notes (cached
 * 2026-10-06), "Current Models" and "Thinking & Effort", and
 * shared/model-migration.md, "Migrating to Claude Opus 5.5", "Migrating to
 * Claude Sonnet 5.5" and "Migrating to Claude Haiku 5.5".
 */

import { HAIKU, OPUS, SONNET } from '@/lib/core/models';

/** The effort levels `output_config.effort` takes on the 5.5 models. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ModelRules = {
  /**
   * Whether `tool_choice` may be `{type: 'tool'}` or `{type: 'any'}`. Where
   * false, a forced choice is a 400 and the request sends `auto`, asking for
   * the tool by name in the prompt.
   */
  forcedTool: boolean;
  /**
   * How thinking is turned off, or null where it cannot be. `disabled` is
   * accepted only at effort `high` or below; `between_tools` is Sonnet 5.5's
   * own form and takes no other field.
   */
  thinkingOff: 'disabled' | 'between_tools' | null;
  /** The effort the model runs at when the request names none. */
  defaultEffort: Effort;
  /**
   * Whether text longer than a sentence or two, in a turn that may call
   * tools, arrives as a progress note in a thinking block rather than as a
   * text block. Its text is empty unless the request asks for
   * `notesDisplay`.
   */
  progressNotes: boolean;
  /**
   * The `thinking.display` that returns a progress note's summary, sent with
   * PROGRESS_NOTES_BETA, or null where the model has no such display.
   */
  notesDisplay: 'updates' | null;
  /** Whether a tool may carry `strict: true`, so its input always matches the schema. */
  strictTools: boolean;
  /** Whether `output_config.format` (structured output) is accepted. */
  structuredOutput: boolean;
  /**
   * Whether a `{role: 'system'}` message may sit inside `messages`, after a
   * user turn, without invalidating the cached history. Where false it is a
   * 400 and the same words go as a user turn instead.
   */
  systemMessages: boolean;
};

/** Every model id `MODELS` names. */
export type CalledModel = typeof OPUS | typeof SONNET | typeof HAIKU;

/**
 * The beta that returns a progress note's summary as the text of its
 * thinking block (`thinking.display: "updates"`), where otherwise it comes
 * back empty. Skill: "Thinking display", beta `thinking-display-updates-2026-08-18`.
 */
export const PROGRESS_NOTES_BETA = 'thinking-display-updates-2026-08-18';

export const MODEL_RULES: Readonly<Record<CalledModel, ModelRules>> = {
  /*
   * Opus 5.5. Skill, "Claude Opus 5.5": thinking can't be disabled
   * (`disabled` and `budget_tokens` both 400 at every effort), effort
   * defaults to `medium`, forced `tool_choice` `any`/`tool` returns a 400
   * ("use auto + strict: true ... or structured outputs"), and text between
   * tool calls comes back as progress-update thinking blocks, empty unless
   * `display: "updates"`. Mid-conversation system messages: supported, no beta.
   */
  [OPUS]: {
    forcedTool: false,
    thinkingOff: null,
    defaultEffort: 'medium',
    progressNotes: true,
    notesDisplay: 'updates',
    strictTools: true,
    structuredOutput: true,
    systemMessages: true,
  },
  /*
   * Sonnet 5.5. Skill, "Claude Sonnet 5.5": `disabled` returns a 400 and
   * `between_tools` turns thinking off (effort `high` or below, no other
   * field), effort defaults to `high`, forced `tool_choice` returns a 400,
   * and text between tool calls comes back as progress-update thinking
   * blocks, empty unless `display: "updates"`. Mid-conversation system
   * messages: supported, no beta.
   */
  [SONNET]: {
    forcedTool: false,
    thinkingOff: 'between_tools',
    defaultEffort: 'high',
    progressNotes: true,
    notesDisplay: 'updates',
    strictTools: true,
    structuredOutput: true,
    systemMessages: true,
  },
  /*
   * Haiku 5.5. Migration guide, "Migrating to Claude Haiku 5.5": a forced
   * `tool_choice` is accepted (the reply then starts with the tool call and
   * has no thinking block), `disabled` works at effort `low` to `high`,
   * effort defaults to `medium`, and structured outputs are the recommended
   * output format. `display: "updates"` is listed for Fable 5.1, Opus 5.5
   * and Sonnet 5.5 only, so Haiku writes its text as text. Mid-conversation
   * system messages: supported, no beta.
   */
  [HAIKU]: {
    forcedTool: true,
    thinkingOff: 'disabled',
    defaultEffort: 'medium',
    progressNotes: false,
    notesDisplay: null,
    strictTools: true,
    structuredOutput: true,
    systemMessages: true,
  },
};

/** The rules for a model id, or null for one the app does not call. */
export function rulesFor(model: string): ModelRules | null {
  return Object.hasOwn(MODEL_RULES, model) ? MODEL_RULES[model as CalledModel] : null;
}

/**
 * Given to `tool_choice` so the model reports through the tool.
 *
 * Forced where the model allows it. Opus 5.5 and Sonnet 5.5 reject a forced
 * tool with a 400, so for them the choice is left to the model and the prompt
 * asks for the tool by name; `readReply` in lib/core/model-call.ts names the
 * reply that answers some other way.
 */
export function forceTool(
  name: string,
  model: string,
): { type: 'tool'; name: string } | { type: 'auto' } {
  return rulesFor(model)?.forcedTool ? { type: 'tool', name } : { type: 'auto' };
}

/**
 * Whether the model writes text longer than a sentence or two, in a turn that
 * may call tools, as a progress note in a thinking block rather than as text,
 * and takes a display that returns that note's summary.
 */
export function writesProgressNotes(model: string): boolean {
  const rules = rulesFor(model);
  return Boolean(rules?.progressNotes && rules.notesDisplay);
}

/** Whether a mid-conversation `{role: 'system'}` message is accepted. */
export function takesSystemMessages(model: string): boolean {
  return rulesFor(model)?.systemMessages ?? false;
}
