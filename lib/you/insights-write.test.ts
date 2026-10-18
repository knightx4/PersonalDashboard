import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Insight } from '@/lib/you/insights';
import {
  ANSWER_SCHEMA,
  estimateMicros,
  insightRequest,
  MAX_ESTIMATE_MICROS,
  noteLink,
  readAnswer,
  renderNotes,
  renderState,
  tripwireNotePaths,
  writeInsights,
  WRITE_MODEL,
  type InsightMaterial,
  type WriteInsightsPorts,
} from '@/lib/you/insights-write';

const earlier = (over: Partial<Insight> = {}): Insight => ({
  id: '11111111-1111-4111-8111-111111111111',
  runId: null,
  kind: 'named_concept',
  claim: 'Socrates Mode is how you avoid deciding.',
  layers: [],
  receipts: [],
  confidence: 'medium',
  liveRef: null,
  status: 'shown',
  supersededBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  verdict: { verdict: 'not_quite', note: 'Too neat', decidedAt: '2026-10-02T00:00:00Z' },
  fired: [],
  ...over,
});

const material = (over: Partial<InsightMaterial> = {}): InsightMaterial => ({
  digest: 'Last time: the waiting pattern.',
  lastRunAt: '2026-09-18T10:00:00Z',
  insights: [earlier()],
  signalsNow: { day: '2026-10-18', signals: { applications: { submitted: 12 } } },
  signalsAtLastRun: { day: '2026-09-18', signals: { applications: { submitted: 9 } } },
  fired: [],
  notes: [{ path: 'Me/About me.md', title: 'About me', body: 'I like cities.', firstWrittenAt: null }],
  journal: [{ path: 'Me/Journal.md', date: '2025-04-04', entry: 'Tired again.' }],
  extracts: [{ kind: 'concept', gist: 'Socrates Mode', quote: 'I am at my best in Socrates Mode', entryDate: null, path: 'Me/Notes to Self.md' }],
  ...over,
});

const card = (claim: string, over: Record<string, unknown> = {}) => ({
  kind: 'testable_claim',
  claim,
  layers: [
    { depth: 'further', text: 'It costs you the screen this week.' },
    { depth: 'saw', text: 'Twelve applications, one reply.' },
    { depth: 'deeper', text: 'Building feels like progress.' },
  ],
  receipts: [
    { source: 'you.insight_signals', row_id: null, quote: '12', link: '/you/insights' },
    { source: 'Me/Notes to Self.md', row_id: null, quote: 'ship it', link: 'javascript:alert(1)' },
  ],
  confidence: 'medium',
  live_ref: null,
  supersedes: null,
  tripwire: null,
  ...over,
});

describe('the request', () => {
  it('thinks adaptively at high effort, caches the stable part and asks for the schema', () => {
    const request = insightRequest(material());
    expect(request.model).toBe(WRITE_MODEL);
    expect(request.thinking).toEqual({ type: 'adaptive' });
    expect(request.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema: ANSWER_SCHEMA } });
    expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' });
    const content = request.messages[0].content as Anthropic.TextBlockParam[];
    expect(content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(content[1].cache_control).toBeUndefined();
    expect(content[0].text).toContain('I am at my best in Socrates Mode');
    expect(content[1].text).toContain('Too neat');
  });

  it('gives each note its link, and the numbers now and at the last run', () => {
    expect(noteLink('Me/Notes to Self.md')).toBe('/vault/n/Me/Notes%20to%20Self.md');
    expect(renderNotes(material())).toContain('/vault/n/Me/About%20me.md');
    const state = renderState(material());
    expect(state).toContain('"submitted":12');
    expect(state).toContain('"submitted":9');
    expect(renderState(material({ digest: null, insights: [] }))).toContain('first call');
  });

  it('estimates a normal run under the limit and an outsized one over it', () => {
    const normal = estimateMicros(insightRequest(material()));
    expect(normal).toBeGreaterThan(900_000);
    expect(normal).toBeLessThan(MAX_ESTIMATE_MICROS);
    const huge = material({ notes: [{ path: 'Me/About me.md', title: 'x', body: 'word '.repeat(250_000), firstWrittenAt: null }] });
    expect(estimateMicros(insightRequest(huge))).toBeGreaterThan(MAX_ESTIMATE_MICROS);
  });

  it('reads the note paths a fired want tripwire found', () => {
    const paths = tripwireNotePaths([
      {
        insightId: 'i',
        kind: 'want_recurring',
        params: {},
        lastFiredAt: '2026-10-10',
        evidence: {
          mentions: [
            { source: 'obsidian.notes', row_id: 'Inbox/walk.md' },
            { source: 'job_search.thoughts', row_id: 'abc' },
            { source: 'obsidian.notes', row_id: 'Inbox/walk.md' },
          ],
        },
      },
    ]);
    expect(paths).toEqual(['Inbox/walk.md']);
  });
});

describe('reading the answer', () => {
  it('keeps layered cards with two receipts, in depth order, with unsafe links dropped', () => {
    const answer = readAnswer({ insights: [card('You test yourself by building.')], summary: 'S.', digest: 'D.' }, []);
    expect(answer?.insights).toHaveLength(1);
    const kept = answer!.insights[0];
    expect(kept.layers.map((l) => l.depth)).toEqual(['saw', 'deeper', 'further']);
    expect(kept.receipts[1].link).toBeNull();
  });

  it('drops a card missing a layer or a receipt, or repeating an earlier claim', () => {
    const answer = readAnswer(
      {
        insights: [
          card('One layer short', { layers: [{ depth: 'saw', text: 'a' }, { depth: 'deeper', text: 'b' }] }),
          card('One receipt', { receipts: [{ source: 'x', row_id: null, quote: 'q', link: null }] }),
          card('Socrates mode is how you avoid deciding!'),
          card('A new one'),
        ],
        summary: 'S.',
        digest: 'D.',
      },
      [earlier()],
    );
    expect(answer?.insights.map((i) => i.claim)).toEqual(['A new one']);
    expect(answer?.dropped).toBe(3);
  });

  it('keeps supersedes only for a known card, and at most five cards', () => {
    const id = earlier().id;
    const answer = readAnswer(
      {
        insights: [
          card('Reworked', { supersedes: id }),
          card('Unknown', { supersedes: '22222222-2222-4222-8222-222222222222' }),
          ...['c', 'd', 'e', 'f'].map((c) => card(`Card ${c}`)),
        ],
        summary: 'S.',
        digest: 'D.',
      },
      [earlier()],
    );
    expect(answer?.insights).toHaveLength(5);
    expect(answer?.insights[0].supersedes).toBe(id);
    expect(answer?.insights[1].supersedes).toBeNull();
  });

  it('writes tripwire params the nightly check reads, and drops a want with no words', () => {
    const answer = readAnswer(
      {
        insights: [
          card('Waiting', {
            tripwire: { kind: 'building_while_waiting', days: 3, window_days: null, rule: null, words: null, min_mentions: null },
          }),
          card('Want', {
            tripwire: { kind: 'want_recurring', days: null, window_days: 30, rule: null, words: [' walk ', 'walk'], min_mentions: 1 },
          }),
          card('Empty want', {
            tripwire: { kind: 'want_recurring', days: null, window_days: null, rule: null, words: [], min_mentions: null },
          }),
        ],
        summary: 'S.',
        digest: 'D.',
      },
      [],
    );
    expect(answer?.insights.map((i) => i.tripwire)).toEqual([
      { kind: 'building_while_waiting', params: { days: 3 } },
      { kind: 'want_recurring', params: { words: ['walk'], min_mentions: 2, window_days: 30 } },
      null,
    ]);
  });

  it('reads nothing from an answer without a digest', () => {
    expect(readAnswer({ insights: [card('x')], summary: 'S.' }, [])).toBeNull();
  });
});

function message(text: string, stop = 'end_turn'): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: WRITE_MODEL,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 30_000, output_tokens: 20_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function ports(over: Partial<WriteInsightsPorts> = {}) {
  const calls = { failed: [] as string[], saved: 0, ledger: 0, recorded: 0 };
  const base: WriteInsightsPorts = {
    queue: async () => ({ runId: 'run-1' }),
    markRunning: async () => {},
    fail: async (_id, error) => {
      calls.failed.push(error);
    },
    gather: async () => material(),
    call: async () =>
      message(JSON.stringify({ insights: [card('First'), card('Second'), card('Third')], summary: 'S.', digest: 'D.' })),
    ledger: async () => {
      calls.ledger += 1;
    },
    save: async (_id, answer) => {
      calls.saved = answer.insights.length;
      return answer.insights.map((_, i) => `id-${i}`);
    },
    record: async () => {
      calls.recorded += 1;
    },
  };
  return { ports: { ...base, ...over }, calls };
}

describe('one run', () => {
  it('writes three cards in one call, logs the spend and records it on Home', async () => {
    const call = vi.fn(ports().ports.call);
    const { ports: p, calls } = ports({ call });
    const result = await writeInsights({ ports: p });
    expect(result).toMatchObject({ ok: true, runId: 'run-1', insightIds: ['id-0', 'id-1', 'id-2'] });
    expect(call).toHaveBeenCalledTimes(1);
    expect(calls).toMatchObject({ saved: 3, ledger: 1, recorded: 1, failed: [] });
    // 30,000 in at $4 and 20,000 out at $20 a million.
    expect(result.ok && result.costMicros).toBe(520_000);
  });

  it('stops before the call when the estimate is over two dollars', async () => {
    const call = vi.fn();
    const huge = material({ notes: [{ path: 'Me/About me.md', title: 'x', body: 'word '.repeat(250_000), firstWrittenAt: null }] });
    const { ports: p, calls } = ports({ call, gather: async () => huge });
    const result = await writeInsights({ ports: p });
    expect(result.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
    expect(calls.failed[0]).toMatch(/over the \$2\.00 limit/);
  });

  it('uses the run it was given, and fails it when the answer cannot be read', async () => {
    const queue = vi.fn();
    const { ports: p, calls } = ports({ queue, call: async () => message('not json') });
    const result = await writeInsights({ ports: p, runId: 'given' });
    expect(queue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, runId: 'given' });
    expect(calls.ledger).toBe(1);
    expect(calls.failed).toHaveLength(1);
  });

  it('fails a refused or cut-off call, and one whose every card repeats', async () => {
    for (const reply of [
      message('', 'refusal'),
      message('{"insights":', 'max_tokens'),
      message(JSON.stringify({ insights: [card(earlier().claim)], summary: 'S.', digest: 'D.' })),
    ]) {
      const { ports: p, calls } = ports({ call: async () => reply });
      expect((await writeInsights({ ports: p })).ok).toBe(false);
      expect(calls.saved).toBe(0);
      expect(calls.failed).toHaveLength(1);
    }
  });

  it('says a run is already going without starting another', async () => {
    const { ports: p } = ports({ queue: async () => ({ error: 'Dash is already looking again.', running: true }) });
    expect(await writeInsights({ ports: p })).toEqual({
      ok: false,
      runId: null,
      error: 'Dash is already looking again.',
      running: true,
    });
  });
});
