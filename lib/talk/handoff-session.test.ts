import { describe, expect, it } from 'vitest';
import { costMicrosFor } from '@/lib/core/spend/pricing';
import {
  closeRefusal,
  sessionHandoffBrief,
  sessionReceipts,
  totalSessionMicros,
  transcriptSpend,
  UNDO_RECEIPT,
} from './handoff-session';

const HANDOFF = {
  id: 'h1',
  advisorId: null,
  conversationId: 'c1',
  advisorChatId: null,
  request: 'Write plan step #3001 with its full detail.',
  asked: 'flesh out 3001 properly',
  summary: 'They are planning the hand-off feature.',
  refs: [{ ref: 'public.plan_items:abc', note: 'the step' }, { ref: 'vault.notes:n1' }],
};

describe('sessionHandoffBrief', () => {
  it('opens as a hand-off brief does, then names the kind, the thread and the context', () => {
    const brief = sessionHandoffBrief(HANDOFF, 'u1');
    const lines = brief.split('\n');
    expect(lines.slice(0, 4)).toEqual(['Hand-off h1', 'kind session', 'user_id u1', 'conversation c1']);
    expect(brief).toContain('"A session hand-off"');
    expect(brief).toContain('Asked: flesh out 3001 properly');
    expect(brief).toContain('The thread so far: They are planning the hand-off feature.');
    expect(brief).toContain('- public.plan_items:abc: the step\n- vault.notes:n1');
    expect(brief.endsWith('Request: Write plan step #3001 with its full detail.')).toBe(true);
  });

  it('names a People chat and its bot, and says when there is no summary or ref', () => {
    const brief = sessionHandoffBrief(
      { ...HANDOFF, conversationId: null, advisorChatId: 'chat1', advisorId: 'bot1', summary: null, refs: [] },
      'u1',
    );
    expect(brief).toContain('\nchat chat1, bot bot1\n');
    expect(brief).toContain('no summary was kept');
    expect(brief).toContain('- none named');
  });

  it('cuts very long words and says the row keeps them', () => {
    const brief = sessionHandoffBrief({ ...HANDOFF, asked: 'x'.repeat(5000) }, 'u1');
    expect(brief).toContain('[cut here; the row keeps the rest]');
    expect(brief.length).toBeLessThan(5000);
  });
});

function line(id: string, model: string, usage: Record<string, unknown>, type = 'assistant'): string {
  return JSON.stringify({ type, message: { id, model, usage } });
}

describe('transcriptSpend', () => {
  it('counts a message once across its content-block lines, and sums per model', () => {
    const main = [
      line('m1', 'claude-opus-5-5', { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 1000 }),
      line('m1', 'claude-opus-5-5', { input_tokens: 2, output_tokens: 40, cache_read_input_tokens: 1000 }),
      line('m2', 'claude-opus-5-5', { input_tokens: 3, output_tokens: 10 }),
      '{"type":"user","message":{"role":"user","content":"hi"}}',
      'not json "usage"',
    ].join('\n');
    const subagent = line('m3', 'claude-haiku-5-5', { input_tokens: 100, output_tokens: 7 });
    const spend = transcriptSpend([main, subagent]);
    expect(spend.map((row) => row.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    const opus = spend[1];
    expect(opus.usage).toMatchObject({ inputTokens: 5, outputTokens: 50, cachedInputTokens: 1000 });
    expect(opus.costMicros).toBe(costMicrosFor('claude-opus-5-5', opus.usage));
  });

  it('charges one-hour cache writes at twice input', () => {
    const [row] = transcriptSpend([
      line('m1', 'claude-opus-5-5', {
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 },
      }),
    ]);
    // Opus 5.5: $4 input, so $8 per million for a one-hour write.
    expect(row.oneHourCacheWrites).toBe(1000);
    expect(row.costMicros).toBe(8000);
  });

  it('keeps an unpriced model with a null cost, skips synthetic ones and strips a context suffix', () => {
    const spend = transcriptSpend([
      [
        line('m1', 'some-other-model', { input_tokens: 10 }),
        line('m2', '<synthetic>', { input_tokens: 10 }),
        line('m3', 'claude-opus-5-5[1m]', { output_tokens: 1 }),
      ].join('\n'),
    ]);
    expect(spend.map((row) => [row.model, row.costMicros])).toEqual([
      ['claude-opus-5-5', 20],
      ['some-other-model', null],
    ]);
    expect(totalSessionMicros(spend)).toBe(20);
    expect(totalSessionMicros([])).toBe(0);
    expect(totalSessionMicros(spend.filter((row) => row.costMicros === null))).toBeNull();
  });
});

describe('sessionReceipts (plan #3005.4)', () => {
  it('reads each link as a label and a path in the app, with the Undo last', () => {
    const made = sessionReceipts(['Prep sheet=/goals/files/f1', 'Goal: run a 10k = /goals/g1'], true);
    expect(made).toEqual({
      ok: true,
      receipts: [
        { label: 'Prep sheet', link: '/goals/files/f1' },
        { label: 'Goal: run a 10k', link: '/goals/g1' },
        UNDO_RECEIPT,
      ],
    });
    expect(sessionReceipts([], false)).toEqual({ ok: true, receipts: [] });
  });

  it('refuses a link with no label, or one outside the app', () => {
    expect(sessionReceipts(['/goals/g1'], false).ok).toBe(false);
    expect(sessionReceipts(['Site=https://example.com'], false).ok).toBe(false);
    expect(sessionReceipts(['Site=//example.com'], false).ok).toBe(false);
    expect(sessionReceipts(Array.from({ length: 8 }, (_, i) => `R${i}=/r/${i}`), true).ok).toBe(false);
  });
});

describe('closeRefusal (plan #3005.4)', () => {
  const ask = { conversationId: 'c1', advisorChatId: null };
  const people = { conversationId: null, advisorChatId: 'chat1' };

  it('holds a done close to telling its thread', () => {
    expect(closeRefusal(ask, { outcome: 'done' }, null)).toMatch(/--reply-turn/);
    expect(closeRefusal(ask, { outcome: 'done', replyTurnId: 't1' }, null)).toBeNull();
    expect(closeRefusal(people, { outcome: 'done' }, null)).toMatch(/--reply/);
    expect(closeRefusal(people, { outcome: 'done' }, '   ')).toMatch(/--reply/);
    expect(closeRefusal(people, { outcome: 'done' }, 'Done: I wrote the step in full.')).toBeNull();
  });

  it('lets a failure close with its reason alone', () => {
    expect(closeRefusal(ask, { outcome: 'failed', reason: 'x' }, null)).toBeNull();
    expect(closeRefusal(people, { outcome: 'failed', reason: 'x' }, null)).toBeNull();
  });
});
