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
  content: ReadonlyArray<{ type: string; name?: string; text?: string; thinking?: unknown; input?: unknown }>;
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
    return { kind: 'cut_off', reason: 'The reply was cut off: it reached its output budget before it finished.' };
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

/*
 * Report-only calls (plan #2937.4).
 *
 * A call that only wants a report back, with no lookups in between, used to
 * offer one tool and hope the model called it. Opus 5.5 and Sonnet 5.5 reject
 * a forced tool, so on them the call depended on the model choosing to, and
 * when it wrote the report as a progress note instead the call "ran but
 * reported nothing". These helpers take the report's JSON schema and use the
 * shape the model's rules allow:
 *
 * - a forced tool where the model takes one (Haiku 5.5): the reply starts
 *   with the call and carries no thinking, so budgets sized for the report
 *   alone still fit;
 * - otherwise structured output (`output_config.format`), where the reply's
 *   text is the report and has to match the schema;
 * - otherwise, for a model with neither, the tool left to the model's choice,
 *   with `readReport` naming the reply that answered some other way.
 */

/** A report's name, description and JSON schema: the shape a tool definition already has. */
export type ReportSchema = {
  name: string;
  description?: string;
  input_schema: object;
};

/** How a model is asked for a report. */
export type ReportShape = 'forced_tool' | 'structured_output' | 'chosen_tool';

/** The shape a report-only call to `model` takes, from its rules. */
export function reportShape(model: string): ReportShape {
  const rules = rulesFor(model);
  if (rules?.forcedTool) return 'forced_tool';
  if (rules?.structuredOutput) return 'structured_output';
  return 'chosen_tool';
}

/** String formats structured output accepts; any other is dropped. */
const OUTPUT_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

/** Keywords structured output does not take, and the words that keep their meaning in the description. */
const UNSUPPORTED: Record<string, (value: unknown) => string> = {
  minimum: (value) => `at least ${value}`,
  maximum: (value) => `at most ${value}`,
  exclusiveMinimum: (value) => `more than ${value}`,
  exclusiveMaximum: (value) => `less than ${value}`,
  multipleOf: (value) => `a multiple of ${value}`,
  minLength: (value) => `at least ${value} characters`,
  maxLength: (value) => `at most ${value} characters`,
  maxItems: (value) => `at most ${value} items`,
  uniqueItems: () => 'no repeated items',
};

/** Keys whose value is data, not a schema, and is copied as it is. */
const LITERAL_KEYS = new Set(['enum', 'const', 'required', 'description', 'type', 'title', 'default', 'examples', 'pattern']);

/**
 * A JSON schema as structured output accepts it: every object closed with
 * `additionalProperties: false`, and the constraints it does not take
 * (numeric bounds, string lengths, `maxItems`, `minItems` above 1, other
 * string formats) dropped, with what they said moved into the description so
 * the model still reads them. The caller's own parse still checks them.
 */
export function outputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(outputSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  const source = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(UNSUPPORTED, key)) {
      notes.push(UNSUPPORTED[key](value));
    } else if (key === 'minItems' && typeof value === 'number' && value > 1) {
      notes.push(`at least ${value} items`);
    } else if (key === 'format' && typeof value === 'string' && !OUTPUT_FORMATS.has(value)) {
      continue;
    } else if ((key === 'properties' || key === '$defs' || key === 'definitions') && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, outputSchema(inner)]));
    } else if (LITERAL_KEYS.has(key)) {
      out[key] = value;
    } else {
      out[key] = outputSchema(value);
    }
  }
  const types = Array.isArray(source.type) ? source.type : [source.type];
  if (types.includes('object') || 'properties' in source) out.additionalProperties = false;
  if (notes.length > 0) {
    const said = typeof out.description === 'string' && out.description.trim() !== '' ? `${out.description.trim()} ` : '';
    out.description = `${said}(${notes.join('; ')})`;
  }
  return out;
}

/**
 * `output_config` asking for a reply in `schema`, or null where the model
 * does not take structured output. `effort`, when given, goes in the same
 * object, since two spreads of `output_config` would overwrite each other.
 * Widened: the installed SDK's types predate `output_config`.
 */
export function outputFormat(schema: object, model: string, effort?: Effort): Record<string, never> | null {
  if (!rulesFor(model)?.structuredOutput) return null;
  return {
    output_config: { format: { type: 'json_schema', schema: outputSchema(schema) }, ...(effort ? { effort } : {}) },
  } as unknown as Record<string, never>;
}

/**
 * The fields a report-only call to `model` spreads into its request, in the
 * shape `reportShape` names: `tools` and `tool_choice` for a tool, or
 * `output_config.format` for structured output. `effort` is folded into the
 * same `output_config`. Widened, as `outputFormat` is.
 */
export function reportRequest(report: ReportSchema, model: string, effort?: Effort): Record<string, never> {
  const withEffort = effort ? { output_config: { effort } } : {};
  switch (reportShape(model)) {
    case 'structured_output':
      return outputFormat(report.input_schema, model, effort)!;
    case 'forced_tool':
      return { tools: [report], tool_choice: { type: 'tool', name: report.name }, ...withEffort } as unknown as Record<string, never>;
    case 'chosen_tool':
      return { tools: [report], tool_choice: { type: 'auto' }, ...withEffort } as unknown as Record<string, never>;
  }
}

/** What a report-only reply held: the report, or which way it fell short and why. */
export type ReportRead =
  | { ok: true; value: unknown }
  | { ok: false; kind: Exclude<ReplyKind, 'tool'> | 'unreadable'; reason: string };

/**
 * The report out of a reply to a call built with `reportRequest`, parsed:
 * the tool's input where it came through the tool, the reply's text read as
 * JSON where it came as structured output. Anything else is read with
 * `readReply`, so a reply cut off, refused or written out of sight says so.
 * `unreadable` is structured output whose text is not JSON, which the schema
 * should rule out and which is named rather than guessed at.
 */
export function readReport(reply: Reply, name: string, model: string): ReportRead {
  const block = reply.content.find((part) => part.type === 'tool_use' && part.name === name);
  if (block) return { ok: true, value: block.input };
  const read = readReply(reply, name, model);
  if (read.kind === 'tool') return { ok: false, kind: 'text', reason: read.reason };
  if (read.kind !== 'text' || reportShape(model) !== 'structured_output') return { ok: false, kind: read.kind, reason: read.reason };
  const text = reply.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      kind: 'unreadable',
      reason: `The reply was not the JSON its schema asked for (stopped: ${reply.stop_reason ?? 'unknown'}).`,
    };
  }
}
