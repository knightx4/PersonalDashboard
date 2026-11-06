import type Anthropic from '@anthropic-ai/sdk';
import { forceTool, readReply, requestShape, strictTool, type ReplyKind } from '@/lib/core/model-call';
import { MODEL_RULES, rulesFor, type CalledModel, type ModelRules } from '@/lib/core/model-rules';
import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { costMicrosFor, MODEL_PRICES, type TokenUsage } from '@/lib/core/spend/pricing';
import type { CaseResult } from './run';

/**
 * The daily check of how each model the app calls sends its replies back
 * (plan #2937.7, supabase/migrations/0297).
 *
 * The rules in lib/core/model-rules.ts say, per model, where an answer
 * arrives: through a tool, as text, or as a progress note in a thinking
 * block. They were written from the docs, and a model can change under
 * them. On 4 November 2026 Opus wrote a 7,350-token answer into a thinking
 * block that came back empty, and nobody knew until the person asked again.
 * So once a day each model gets four small requests, at effort low:
 *
 *   tool        a paragraph asked for through a tool, tool choice as
 *               forceTool gives it
 *   forced      the same request with the tool forced, sent only where the
 *               rules say that is a 400; max_tokens 1, so it costs nothing
 *               while the rule holds
 *   structured  a short report through output_config.format
 *   prose       a real lookup turn, then a one-sentence answer as text
 *
 * Each reply is sorted by readReply (lib/core/model-call.ts) and held to
 * the rules. A reply that breaks one is a failed probe, and a run with any
 * writes a Dev note naming the model and the rule. The run is a row in
 * core.dash_eval_runs, trigger 'models', with its cost.
 *
 * Nothing here talks to the network or a database; the ports are in
 * inngest/core/dash-quality.ts.
 */

/** A run may not spend more than this, in micro-dollars: five cents. */
export const MODEL_CHECK_CAP_MICROS = 50_000;

/**
 * The prompt a probe is costed at before it is sent. Measured prompts are
 * 100 to 700 tokens; tools add the tool-use system prompt.
 */
export const PROBE_INPUT_CEILING = 1_000;

/** Cheapest first, so a run cut short by the cap has still checked the most models. */
export const CHECKED_MODELS: readonly CalledModel[] = [HAIKU, SONNET, OPUS];

export type ProbeName = 'tool' | 'forced' | 'structured' | 'prose';

/** What each probe asks, in the words the results and the note use. */
export const PROBE_TITLES: Record<ProbeName, string> = {
  tool: 'a paragraph asked for through a tool',
  forced: 'a forced tool choice',
  structured: 'a report through structured output',
  prose: 'a lookup followed by a one-sentence answer',
};

/** The most each probe's call may write. The prose probe is two calls of this. */
export const PROBE_MAX_TOKENS: Record<ProbeName, number> = {
  tool: 400,
  forced: 1,
  structured: 250,
  prose: 200,
};

/** One request as the port sends it. */
export type ProbeRequest = { params: Anthropic.MessageCreateParamsNonStreaming; beta: string[] };

export type ProbeCall =
  | { ok: true; reply: Anthropic.Message; usage: TokenUsage; seconds: number }
  | { ok: false; status: number | null; message: string; seconds: number };

export type ModelCheckPorts = {
  owner(): Promise<string>;
  /** Sends one request. An API error comes back as `ok: false` with its status, never thrown. */
  call(request: ProbeRequest): Promise<ProbeCall>;
  /** Keeps one call's tokens in core.model_spend. */
  spend(userId: string, model: string, usage: TokenUsage): Promise<void>;
  start(row: { userId: string; models: string; deploy: string | null }): Promise<string>;
  finish(id: string, row: { cases: number; passed: number; results: ProbeResult[]; costMicros: number; noteId: string | null; error: string | null }): Promise<void>;
  writeNote(userId: string, body: string): Promise<string>;
};

/** A rule a reply broke: the field of ModelRules, or what the probe itself needs. */
export type BrokenRule = keyof ModelRules | 'answer' | 'budget' | 'refusal' | 'request';

export type ProbeResult = CaseResult & {
  model: string;
  probe: ProbeName;
  /** What readReply made of the reply, or null where none came back. */
  kind: ReplyKind | null;
  /** The rule the reply broke, or null when it held. */
  rule: BrokenRule | null;
  /** Said about a reply that held but came back in a shape worth knowing about. */
  remark?: string;
};

const ANSWER = 'answer';
const LOOK_UP = 'look_up';

const ANSWER_TOOL: Anthropic.Tool = {
  name: ANSWER,
  description: 'Give your answer to the person. They see only what you pass here.',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The whole answer.' } },
    required: ['text'],
    additionalProperties: false,
  },
};

const LOOK_UP_TOOL: Anthropic.Tool = {
  name: LOOK_UP,
  description: 'Look up a stored fact by its key.',
  input_schema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
};

const REPORT_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
  required: ['title', 'items'],
  additionalProperties: false,
};

const SYSTEM = 'You are being checked for how your replies come back. Answer briefly and plainly.';

/** What the stored fact says, so the prose answer can be checked against it. */
const KETTLE_FACT = 'The kettle on the counter holds 1.7 litres.';

/** Widened: the installed SDK's types predate strict tools, output_config and adaptive thinking. */
function params(fields: Record<string, unknown>): Anthropic.MessageCreateParamsNonStreaming {
  return fields as unknown as Anthropic.MessageCreateParamsNonStreaming;
}

/** The request each probe sends to `model`. `prose` is its first call; the second is built from the reply. */
export function probeRequest(model: CalledModel, probe: Exclude<ProbeName, 'prose'> | 'lookup'): ProbeRequest {
  const { thinking, effort, beta } = requestShape(model, 'low');
  const base = { model, system: SYSTEM, ...thinking, ...effort };
  switch (probe) {
    case 'tool':
    case 'forced':
      return {
        params: params({
          ...base,
          max_tokens: PROBE_MAX_TOKENS[probe],
          tools: [strictTool(ANSWER_TOOL, model)],
          tool_choice: probe === 'forced' ? { type: 'tool', name: ANSWER } : forceTool(ANSWER, model),
          messages: [
            {
              role: 'user',
              content: `In four sentences, about sixty words, explain why a kettle whistles when it boils. Give it through the ${ANSWER} tool.`,
            },
          ],
        }),
        beta,
      };
    case 'structured':
      return {
        params: params({
          model,
          system: SYSTEM,
          max_tokens: PROBE_MAX_TOKENS.structured,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: REPORT_SCHEMA } },
          messages: [{ role: 'user', content: 'Report three short facts about the Moon: a title and three items.' }],
        }),
        beta: [],
      };
    case 'lookup':
      return {
        params: params({
          ...base,
          max_tokens: PROBE_MAX_TOKENS.prose,
          tools: [strictTool(LOOK_UP_TOOL, model)],
          tool_choice: forceTool(LOOK_UP, model),
          messages: [
            {
              role: 'user',
              content: `How much does the kettle hold? Look it up with ${LOOK_UP} (key "kettle"), then answer in one sentence.`,
            },
          ],
        }),
        beta,
      };
  }
}

/** The second call of the prose probe: the lookup's reply as it came, and the fact it asked for. */
export function proseRequest(first: ProbeRequest, reply: Anthropic.Message, toolUseId: string): ProbeRequest {
  const sent = first.params as unknown as { messages: Anthropic.MessageParam[]; tool_choice: unknown };
  return {
    params: params({
      ...(first.params as unknown as Record<string, unknown>),
      // The lookup is done: nothing is forced now, so the answer can be text.
      tool_choice: { type: 'auto' },
      messages: [
        ...sent.messages,
        { role: 'assistant', content: reply.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: KETTLE_FACT }] },
      ],
    }),
    beta: first.beta,
  };
}

/** The most a request can cost, at PROBE_INPUT_CEILING tokens in and its max_tokens out. */
export function worstCaseMicros(request: ProbeRequest): number {
  const price = MODEL_PRICES[request.params.model];
  if (!price) return MODEL_CHECK_CAP_MICROS;
  return Math.ceil(PROBE_INPUT_CEILING * price.input + request.params.max_tokens * price.output);
}

/** The summaries in a reply's thinking blocks, which are empty unless the request asked for display "updates". */
function noteText(reply: Anthropic.Message): string {
  return (reply.content as { type: string; thinking?: unknown }[])
    .flatMap((block) => (block.type === 'thinking' && typeof block.thinking === 'string' ? [block.thinking.trim()] : []))
    .filter(Boolean)
    .join('\n\n');
}

function textOf(reply: Anthropic.Message): string {
  return reply.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('').trim();
}

type Verdict = { rule: BrokenRule | null; failure?: string; remark?: string };

/**
 * A reply with nothing outside thinking. Where the model writes progress
 * notes and the request asked for their display, a summary in a thinking
 * block is a shape the code expects: Dash asks once more (lib/dash/loop.ts).
 * An empty one means the answer was lost out of sight, which is the
 * 4 November shape.
 */
function hiddenVerdict(model: string, reply: Anthropic.Message, rules: ModelRules): Verdict {
  if (rules.progressNotes && rules.notesDisplay) {
    if (noteText(reply)) {
      return { rule: null, remark: 'The answer came back as a progress note with its summary, which Dash asks again for.' };
    }
    return {
      rule: 'notesDisplay',
      failure: `${model} wrote its answer into a thinking block that came back empty, though the request asked for display "${rules.notesDisplay}" (stopped: ${reply.stop_reason}). The answer was lost out of sight.`,
    };
  }
  return {
    rule: 'progressNotes',
    failure: `${model} put nothing outside thinking (stopped: ${reply.stop_reason}), but its rules say it writes text as text.`,
  };
}

function cutOrRefused(model: string, kind: ReplyKind, reason: string): Verdict | null {
  if (kind === 'cut_off') return { rule: 'budget', failure: `${model} reached max_tokens before it finished. ${reason}` };
  if (kind === 'refused') return { rule: 'refusal', failure: `${model} declined a harmless probe. ${reason}` };
  return null;
}

/** The tool probe: the paragraph through the answer tool, valid against its schema. */
export function judgeTool(model: CalledModel, reply: Anthropic.Message): Verdict & { kind: ReplyKind } {
  const rules = MODEL_RULES[model];
  const read = readReply(reply, ANSWER, model);
  const cut = cutOrRefused(model, read.kind, read.reason);
  if (cut) return { ...cut, kind: read.kind };
  if (read.kind === 'hidden') return { ...hiddenVerdict(model, reply, rules), kind: read.kind };
  if (read.kind === 'text') {
    return {
      kind: read.kind,
      rule: rules.forcedTool ? 'forcedTool' : 'answer',
      failure: rules.forcedTool
        ? `${model} was sent a forced tool choice and answered in prose instead.`
        : `${model} answered in prose though the prompt named the ${ANSWER} tool.`,
    };
  }
  const call = reply.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === ANSWER);
  const text = (call?.input as { text?: unknown } | undefined)?.text;
  if (typeof text !== 'string' || !text.trim() || Object.keys((call?.input as object) ?? {}).some((key) => key !== 'text')) {
    return { kind: read.kind, rule: 'strictTools', failure: `${model} called the strict ${ANSWER} tool with input its schema does not allow.` };
  }
  if (rules.forcedTool && reply.content[0]?.type !== 'tool_use') {
    return {
      kind: read.kind,
      rule: 'forcedTool',
      failure: `${model} was sent a forced tool choice and its reply began with a ${reply.content[0]?.type} block, not the tool call.`,
    };
  }
  return { kind: read.kind, rule: null };
}

/** The forced probe: a model whose rules say forced tool choice is a 400 must still say so. */
export function judgeForced(model: CalledModel, call: ProbeCall): Verdict & { kind: ReplyKind | null } {
  if (!call.ok) {
    return call.status === 400
      ? { kind: null, rule: null }
      : { kind: null, rule: 'request', failure: `The forced tool request to ${model} failed with ${call.status ?? 'no status'}: ${call.message}` };
  }
  return {
    kind: readReply(call.reply, ANSWER, model).kind,
    rule: 'forcedTool',
    failure: `${model} accepted a forced tool choice, which its rules say is a 400. It may take one now: check the docs and set forcedTool.`,
  };
}

/** The structured probe: JSON in a text block that matches the schema. */
export function judgeStructured(model: CalledModel, reply: Anthropic.Message): Verdict & { kind: ReplyKind } {
  const read = readReply(reply, undefined, model);
  const cut = cutOrRefused(model, read.kind, read.reason);
  if (cut) return { ...cut, kind: read.kind };
  if (read.kind !== 'text') return { ...hiddenVerdict(model, reply, MODEL_RULES[model]), kind: read.kind };
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(reply));
  } catch {
    return { kind: read.kind, rule: 'structuredOutput', failure: `${model} answered a structured output request with text that is not JSON.` };
  }
  const report = parsed as { title?: unknown; items?: unknown };
  const fits =
    typeof report === 'object' &&
    report !== null &&
    typeof report.title === 'string' &&
    Array.isArray(report.items) &&
    report.items.every((item) => typeof item === 'string');
  return fits
    ? { kind: read.kind, rule: null }
    : { kind: read.kind, rule: 'structuredOutput', failure: `${model} returned JSON that does not match the schema it was given.` };
}

/**
 * The prose probe's first reply, when it did not call the lookup. A hidden
 * reply that lost its text names the display rule; anything else is the
 * model not calling a tool it was asked for, forced or by name.
 */
export function missedLookup(model: CalledModel, reply: Anthropic.Message, rules: ModelRules): Verdict {
  const read = readReply(reply, LOOK_UP, model);
  const cut = cutOrRefused(model, read.kind, read.reason);
  if (cut) return cut;
  if (read.kind === 'hidden') {
    const hidden = hiddenVerdict(model, reply, rules);
    if (hidden.rule) return hidden;
  }
  return {
    rule: rules.forcedTool ? 'forcedTool' : 'answer',
    failure: `${model} was asked to look the fact up with ${LOOK_UP} and did not call it. ${read.reason}`,
  };
}

/** The prose probe's second reply: the one-sentence answer as text. */
export function judgeProse(model: CalledModel, reply: Anthropic.Message): Verdict & { kind: ReplyKind } {
  const read = readReply(reply, undefined, model);
  const cut = cutOrRefused(model, read.kind, read.reason);
  if (cut) return { ...cut, kind: read.kind };
  if (read.kind === 'hidden') return { ...hiddenVerdict(model, reply, MODEL_RULES[model]), kind: read.kind };
  if (reply.content.some((block) => block.type === 'tool_use')) {
    return { kind: 'tool', rule: 'answer', failure: `${model} looked something up again instead of answering from the lookup it had.` };
  }
  return { kind: read.kind, rule: null };
}

function result(
  model: CalledModel,
  probe: ProbeName,
  verdict: Verdict & { kind: ReplyKind | null },
  extra: { body: string; stop: string; seconds: number; costMicros: number },
): ProbeResult {
  return {
    case: `${model}/${probe}`,
    question: `${model}: ${PROBE_TITLES[probe]}`,
    passed: verdict.rule === null,
    failures: verdict.failure ? [verdict.failure] : [],
    body: extra.body.slice(0, 1000),
    stop: extra.stop,
    lookups: [],
    seconds: Math.round(extra.seconds * 10) / 10,
    costMicros: extra.costMicros,
    model,
    probe,
    kind: verdict.kind,
    rule: verdict.rule,
    ...(verdict.remark ? { remark: verdict.remark } : {}),
  };
}

/** What the reply showed, for the run row: its text, or its tool input, or its notes. */
function bodyOf(reply: Anthropic.Message): string {
  const text = textOf(reply);
  if (text) return text;
  const call = reply.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  if (call) return JSON.stringify(call.input);
  return noteText(reply);
}

/** The Dev note for a run with a broken rule, or null when every reply held. */
export function modelReplyNote(results: readonly ProbeResult[], runId: string): string | null {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return null;
  const lines = [
    `Model reply check: ${failed.length} of ${results.length} probes came back in a shape the code does not expect`,
    '',
  ];
  for (const r of failed) lines.push(`- ${r.model}, ${PROBE_TITLES[r.probe]} (rule: ${r.rule}): ${r.failures.join(' ')}`);
  lines.push(
    '',
    `Each rule is a field of MODEL_RULES in lib/core/model-rules.ts. Correct the rule from the docs, or teach readReply in lib/core/model-call.ts the new shape, and fix the callers it breaks. Run ${runId} in core.dash_eval_runs has every reply.`,
  );
  return lines.join('\n');
}

export async function runModelCheck(
  ports: ModelCheckPorts,
  options: { deploy: string | null; models?: readonly CalledModel[] },
): Promise<{ runId: string; probes: number; passed: number; costMicros: number; noteId: string | null }> {
  const models = options.models ?? CHECKED_MODELS;
  const userId = await ports.owner();
  const runId = await ports.start({ userId, models: models.join(', '), deploy: options.deploy });
  const results: ProbeResult[] = [];
  let spent = 0;
  let error: string | null = null;

  /** Sends one request if the cap allows it, keeping its spend. Null when the cap stopped it. */
  const send = async (request: ProbeRequest): Promise<ProbeCall | null> => {
    if (spent + worstCaseMicros(request) > MODEL_CHECK_CAP_MICROS) return null;
    const call = await ports.call(request);
    if (call.ok) {
      spent += costMicrosFor(request.params.model, call.usage) ?? 0;
      await ports.spend(userId, request.params.model, call.usage);
    }
    return call;
  };
  const skipped = (model: CalledModel, probe: ProbeName) =>
    result(model, probe, { kind: null, rule: null, remark: 'Not sent: it could have taken the run past five cents.' }, { body: '', stop: 'skipped', seconds: 0, costMicros: 0 });
  const failedCall = (model: CalledModel, probe: ProbeName, call: Extract<ProbeCall, { ok: false }>) =>
    result(
      model,
      probe,
      { kind: null, rule: 'request', failure: `The request to ${model} failed with ${call.status ?? 'no status'}: ${call.message}` },
      { body: '', stop: 'failed', seconds: call.seconds, costMicros: 0 },
    );
  const answered = (model: CalledModel, probe: ProbeName, call: Extract<ProbeCall, { ok: true }>, verdict: Verdict & { kind: ReplyKind | null }, costMicros?: number) =>
    result(model, probe, verdict, {
      body: bodyOf(call.reply),
      stop: call.reply.stop_reason ?? 'unknown',
      seconds: call.seconds,
      costMicros: costMicros ?? costMicrosFor(model, call.usage) ?? 0,
    });

  try {
    for (const model of models) {
      const rules = rulesFor(model)!;

      const tool = await send(probeRequest(model, 'tool'));
      results.push(!tool ? skipped(model, 'tool') : tool.ok ? answered(model, 'tool', tool, judgeTool(model, tool.reply)) : failedCall(model, 'tool', tool));

      if (!rules.forcedTool) {
        const forced = await send(probeRequest(model, 'forced'));
        results.push(
          !forced
            ? skipped(model, 'forced')
            : result(model, 'forced', judgeForced(model, forced), {
                body: forced.ok ? bodyOf(forced.reply) : forced.message.slice(0, 300),
                stop: forced.ok ? (forced.reply.stop_reason ?? 'unknown') : `http ${forced.status ?? '?'}`,
                seconds: forced.seconds,
                costMicros: forced.ok ? (costMicrosFor(model, forced.usage) ?? 0) : 0,
              }),
        );
      }

      if (rules.structuredOutput) {
        const structured = await send(probeRequest(model, 'structured'));
        results.push(
          !structured
            ? skipped(model, 'structured')
            : structured.ok
              ? answered(model, 'structured', structured, judgeStructured(model, structured.reply))
              : failedCall(model, 'structured', structured),
        );
      }

      const first = probeRequest(model, 'lookup');
      const lookup = await send(first);
      if (!lookup) {
        results.push(skipped(model, 'prose'));
        continue;
      }
      if (!lookup.ok) {
        results.push(failedCall(model, 'prose', lookup));
        continue;
      }
      const lookupCost = costMicrosFor(model, lookup.usage) ?? 0;
      const use = lookup.reply.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === LOOK_UP);
      if (!use) {
        results.push(answered(model, 'prose', lookup, { ...missedLookup(model, lookup.reply, rules), kind: readReply(lookup.reply, LOOK_UP, model).kind }, lookupCost));
        continue;
      }
      const prose = await send(proseRequest(first, lookup.reply, use.id));
      if (!prose) {
        results.push(skipped(model, 'prose'));
      } else if (!prose.ok) {
        results.push(failedCall(model, 'prose', prose));
      } else {
        results.push(answered(model, 'prose', prose, judgeProse(model, prose.reply), lookupCost + (costMicrosFor(model, prose.usage) ?? 0)));
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const asked = results.filter((r) => r.stop !== 'skipped');
  const passed = asked.filter((r) => r.passed).length;
  let body = modelReplyNote(results, runId);
  if (error) body = `${body ?? 'Model reply check: the run stopped before it finished'}\n\nThe run threw: ${error}`;
  const noteId = body ? await ports.writeNote(userId, body) : null;
  await ports.finish(runId, { cases: asked.length, passed, results, costMicros: spent, noteId, error });
  return { runId, probes: asked.length, passed, costMicros: spent, noteId };
}
