import { describe, expect, it, vi } from 'vitest';
import { draftPrompt, draftTopic } from './draft';

/**
 * The drafting call around the rules in draft-payload.test.ts: what it is
 * told, that the spend is reported even when the draft is unusable, and that
 * a too-broad goal and a broken call stay two different answers.
 */

vi.mock('server-only', () => ({}));

function clientReturning(input: unknown, usage = { input_tokens: 10, output_tokens: 20 }) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'tool_use', name: 'report_topic', input }],
        usage,
        stop_reason: 'tool_use',
      }),
    },
  };
}

const DRAFT = {
  name: 'Discounted cash flow',
  scope: 'Valuing a company as the discounted sum of its future free cash flows; multiples are a neighbour.',
  ceiling: 2,
  fields: ['finance'],
  levels: [
    { level: 1, checks: ['Can say it is a way of valuing a company', 'Can name what it is used for'] },
    { level: 2, checks: ['Can define it in their own words', 'Can say what is discounted and why'] },
  ],
  links: [{ from_level: 2, topic: 'Return', level: 2 }],
  missing: [],
};

const MAP = [{ id: 't-return', name: 'Return', scope: 'What a return is.', ceiling: 6, approved: true }];

describe('draftTopic', () => {
  it('returns the draft and reports the spend', async () => {
    const client = clientReturning(DRAFT);
    const spent = vi.fn();
    const result = await draftTopic({
      goal: 'DCF',
      map: MAP,
      fields: [{ id: 'f-fin', slug: 'finance', name: 'Finance' }],
      anthropicApiKey: 'test',
      client: client as never,
      onSpend: spent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.cells).toHaveLength(2);
      expect(result.draft.links[0]).toMatchObject({ topicId: 't-return', fromLevel: 2, level: 2 });
      expect(result.draft.fieldIds).toEqual(['f-fin']);
    }
    expect(spent).toHaveBeenCalledTimes(1);
  });

  it('says a too-broad goal is too vague, and still reports the spend', async () => {
    const spent = vi.fn();
    const result = await draftTopic({
      goal: 'finance',
      map: [],
      fields: [],
      anthropicApiKey: 'test',
      client: clientReturning({ ...DRAFT, too_vague: true }) as never,
      onSpend: spent,
    });
    expect(result).toMatchObject({ ok: false, reason: 'too-vague' });
    expect(spent).toHaveBeenCalledTimes(1);
  });

  it('reports a broken call as an error', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } };
    const result = await draftTopic({
      goal: 'DCF',
      map: [],
      fields: [],
      anthropicApiKey: 'test',
      client: client as never,
    });
    expect(result).toEqual({ ok: false, reason: 'error', detail: 'boom' });
  });
});

describe('draftPrompt', () => {
  it('names the approved topics with their ceilings and leaves drafts out', () => {
    const prompt = draftPrompt({
      goal: 'CAPM',
      map: [...MAP, { id: 't-draft', name: 'Beta', scope: 'Draft.', ceiling: 5, approved: false }],
      fields: [],
    });
    expect(prompt).toContain('- Return (to 6): What a return is.');
    expect(prompt).not.toContain('Beta');
  });

  it('carries the scope a link gave a wanted topic', () => {
    const prompt = draftPrompt({ goal: 'Risk-free rate', scope: 'The return on a riskless asset.', map: [], fields: [] });
    expect(prompt).toContain('with this scope: The return on a riskless asset.');
  });
});
