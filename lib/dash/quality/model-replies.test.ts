import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { PROGRESS_NOTES_BETA, type CalledModel } from '@/lib/core/model-rules';
import type { TokenUsage } from '@/lib/core/spend/pricing';
import {
  CHECKED_MODELS,
  MODEL_CHECK_CAP_MICROS,
  PROBE_INPUT_CEILING,
  probeRequest,
  runModelCheck,
  worstCaseMicros,
  type ModelCheckPorts,
  type ProbeCall,
  type ProbeRequest,
  type ProbeResult,
} from './model-replies';

const USAGE: TokenUsage = { inputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 150 };

function message(content: unknown[], stop: string): Anthropic.Message {
  return { id: 'msg', type: 'message', role: 'assistant', model: 'm', content, stop_reason: stop, usage: {} } as unknown as Anthropic.Message;
}

/** The reply each probe gets when every rule holds. */
function healthy(request: ProbeRequest): ProbeCall {
  const p = request.params as unknown as {
    model: CalledModel;
    tools?: { name: string }[];
    tool_choice?: { type: string };
    output_config?: { format?: unknown };
    messages: unknown[];
  };
  const ok = (reply: Anthropic.Message): ProbeCall => ({ ok: true, reply, usage: USAGE, seconds: 1 });
  if (p.output_config?.format) return ok(message([{ type: 'text', text: '{"title":"The Moon","items":["a","b","c"]}' }], 'end_turn'));
  if (p.tool_choice?.type === 'tool' && p.model !== HAIKU) {
    return { ok: false, status: 400, message: 'tool_choice: type "tool" and "any" are not supported for this model.', seconds: 0.2 };
  }
  const tool = p.tools?.[0]?.name;
  if (tool === 'answer') return ok(message([{ type: 'tool_use', id: 't1', name: 'answer', input: { text: 'Steam squeezes through the spout.' } }], 'tool_use'));
  if (p.messages.length === 1) return ok(message([{ type: 'tool_use', id: 't2', name: 'look_up', input: { key: 'kettle' } }], 'tool_use'));
  return ok(message([{ type: 'text', text: 'It holds 1.7 litres.' }], 'end_turn'));
}

/** The tool probe, not the forced one: the paragraph asked for through the answer tool. */
function isToolProbe(request: ProbeRequest, model: string): boolean {
  const p = request.params as unknown as { model: string; tools?: { name: string }[]; max_tokens: number };
  return p.model === model && p.tools?.[0]?.name === 'answer' && p.max_tokens > 1;
}

function ports(answer: (request: ProbeRequest) => ProbeCall = healthy) {
  const sent: ProbeRequest[] = [];
  const notes: string[] = [];
  const spent: { model: string; usage: TokenUsage }[] = [];
  let finished: Parameters<ModelCheckPorts['finish']>[1] | null = null;
  const p: ModelCheckPorts = {
    owner: async () => 'owner-1',
    call: async (request) => {
      sent.push(request);
      return answer(request);
    },
    spend: async (_user, model, usage) => {
      spent.push({ model, usage });
    },
    start: async () => 'run-1',
    finish: async (_id, row) => {
      finished = row;
    },
    writeNote: async (_user, body) => {
      notes.push(body);
      return 'note-1';
    },
  };
  return { p, sent, notes, spent, finished: () => finished! };
}

describe('the model reply check', () => {
  it('sends each model its probes, records the cost under five cents, and writes no note when every rule holds', async () => {
    const { p, sent, notes, spent, finished } = ports();
    const out = await runModelCheck(p, { deploy: 'abc' });
    // Haiku: tool, structured, lookup, prose. Sonnet and Opus add the forced probe.
    expect(sent).toHaveLength(14);
    expect(out.probes).toBe(11);
    expect(out.passed).toBe(11);
    expect(notes).toEqual([]);
    expect(out.noteId).toBeNull();
    // Every answered call is kept as spend; the refused forced calls cost nothing.
    expect(spent).toHaveLength(12);
    expect(out.costMicros).toBeGreaterThan(0);
    expect(out.costMicros).toBeLessThan(MODEL_CHECK_CAP_MICROS);
    expect(finished()).toMatchObject({ cases: 11, passed: 11, costMicros: out.costMicros, noteId: null, error: null });
  });

  it('writes a Dev note naming the model and the rule for a reply in the 4 November shape', async () => {
    // Opus wrote its answer into a thinking block that came back empty and
    // ended its turn: no tool call, no text.
    const { p, notes, finished } = ports((request) =>
      isToolProbe(request, OPUS)
        ? { ok: true, reply: message([{ type: 'thinking', thinking: '', signature: 's' }], 'end_turn'), usage: USAGE, seconds: 40 }
        : healthy(request),
    );
    const out = await runModelCheck(p, { deploy: null });
    expect(out.noteId).toBe('note-1');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Model reply check: 1 of 11 probes');
    expect(notes[0]).toContain('claude-opus-5-5');
    expect(notes[0]).toContain('rule: notesDisplay');
    expect(notes[0]).toContain('came back empty');
    const failed = (finished().results as ProbeResult[]).filter((r) => !r.passed);
    expect(failed).toEqual([expect.objectContaining({ model: OPUS, probe: 'tool', kind: 'hidden', rule: 'notesDisplay' })]);
  });

  it('accepts a progress note that kept its summary, which Dash asks again for', async () => {
    const { p, notes, finished } = ports((request) =>
      isToolProbe(request, SONNET)
        ? { ok: true, reply: message([{ type: 'thinking', thinking: 'Steam squeezes through the spout.' }], 'end_turn'), usage: USAGE, seconds: 3 }
        : healthy(request),
    );
    await runModelCheck(p, { deploy: null });
    expect(notes).toEqual([]);
    const sonnet = (finished().results as ProbeResult[]).find((r) => r.case === `${SONNET}/tool`)!;
    expect(sonnet).toMatchObject({ passed: true, kind: 'hidden', rule: null });
    expect(sonnet.remark).toContain('progress note');
  });

  it('names forcedTool when a model takes the forced tool its rules say it refuses', async () => {
    const { p, notes } = ports((request) =>
      request.params.model === SONNET && (request.params.tool_choice as { type?: string } | undefined)?.type === 'tool'
        ? { ok: true, reply: message([{ type: 'tool_use', id: 't', name: 'answer', input: { text: 'S' } }], 'max_tokens'), usage: USAGE, seconds: 1 }
        : healthy(request),
    );
    await runModelCheck(p, { deploy: null });
    expect(notes[0]).toContain(`${SONNET}, a forced tool choice (rule: forcedTool)`);
  });

  it('names structuredOutput when the report is not JSON', async () => {
    const { p, notes } = ports((request) =>
      request.params.model === HAIKU && (request.params as unknown as { output_config?: { format?: unknown } }).output_config?.format
        ? { ok: true, reply: message([{ type: 'text', text: 'The Moon: it is far.' }], 'end_turn'), usage: USAGE, seconds: 1 }
        : healthy(request),
    );
    await runModelCheck(p, { deploy: null });
    expect(notes[0]).toContain(`${HAIKU}, a report through structured output (rule: structuredOutput)`);
  });

  it('names progressNotes when Haiku, whose rules say it writes text as text, hides its answer', async () => {
    const { p, notes } = ports((request) =>
      request.params.model === HAIKU && request.params.messages.length === 3
        ? { ok: true, reply: message([{ type: 'thinking', thinking: '' }], 'end_turn'), usage: USAGE, seconds: 1 }
        : healthy(request),
    );
    await runModelCheck(p, { deploy: null });
    expect(notes[0]).toContain(`${HAIKU}, a lookup followed by a one-sentence answer (rule: progressNotes)`);
  });

  it('sends the lookup turn back as it came, with the fact, before asking for prose', async () => {
    const { p, sent } = ports();
    await runModelCheck(p, { deploy: null, models: [OPUS] });
    const prose = sent.at(-1)!.params as unknown as { messages: { role: string; content: unknown }[]; tool_choice: unknown };
    expect(prose.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(prose.tool_choice).toEqual({ type: 'auto' });
    expect(JSON.stringify(prose.messages[2].content)).toContain('1.7 litres');
  });

  it('builds each probe from the rules: low effort, the progress-note display, and no forced tool where it is a 400', () => {
    const opus = probeRequest(OPUS, 'tool');
    expect(opus.beta).toEqual([PROGRESS_NOTES_BETA]);
    expect(opus.params).toMatchObject({ tool_choice: { type: 'auto' }, thinking: { type: 'adaptive', display: 'updates' }, output_config: { effort: 'low' } });
    expect(probeRequest(HAIKU, 'tool').params).toMatchObject({ tool_choice: { type: 'tool', name: 'answer' } });
    expect(probeRequest(SONNET, 'forced').params).toMatchObject({ max_tokens: 1, tool_choice: { type: 'tool', name: 'answer' } });
    expect(probeRequest(SONNET, 'structured').params).toMatchObject({ output_config: { effort: 'low', format: { type: 'json_schema' } } });
  });

  it('skips a probe that could take the run past five cents, rather than sending it', async () => {
    // Every call at its worst: the prompt at the ceiling and every token of max_tokens written.
    const { p, finished } = ports((request) => {
      const call = healthy(request);
      const worst: TokenUsage = { inputTokens: PROBE_INPUT_CEILING, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: request.params.max_tokens };
      return call.ok ? { ...call, usage: worst } : call;
    });
    const out = await runModelCheck(p, { deploy: null });
    expect(out.costMicros).toBeLessThanOrEqual(MODEL_CHECK_CAP_MICROS);
    expect((finished().results as ProbeResult[]).some((r) => r.stop === 'skipped')).toBe(true);
  });

  it('costs one probe of each model well inside the cap', () => {
    for (const model of CHECKED_MODELS) {
      expect(worstCaseMicros(probeRequest(model, 'tool'))).toBeLessThan(MODEL_CHECK_CAP_MICROS / 3);
    }
  });
});
