import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { markExplanation, markFollowUp, TEACH_BACK_MODEL } from './mark-teach-back';

/** Marking a teach-back (plan #1054), with the model stubbed. */

const idea = {
  name: 'Tree search',
  claim: 'Searching ahead beats judging a position alone.',
  basis: 'AlphaGo: Algorithm',
};

type Sent = { model: string; system: string; tool_choice: unknown; messages: { role: string; content: string }[] };

function stubClient(content: unknown[]) {
  const sent: Sent[] = [];
  const client = {
    messages: {
      create: async (params: Sent) => {
        sent.push(params);
        return { content, stop_reason: 'tool_use', usage: { input_tokens: 700, output_tokens: 200 } };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe('marking the explanation', () => {
  it('returns the marks and the follow-up, and records the spend', async () => {
    const { client, sent } = stubClient([
      {
        type: 'tool_use',
        name: 'report_marking',
        input: {
          why: 'Right idea, no pruning.',
          holds: true,
          right: [' you said it looks ahead ', ''],
          missing: ['the networks narrowing it', 'a', 'b', 'c', 'd'],
          own_example: true,
          follow_up: 'Why not search every move?',
          follow_up_expected: 'Too many positions.',
        },
      },
    ]);
    const spend: SpendReport[] = [];
    const result = await markExplanation({
      idea,
      prompt: 'Explain Tree search to a friend.',
      response: 'It looks ahead at the moves, like planning chess.',
      anthropicApiKey: 'test',
      client,
      onSpend: (report) => spend.push(report),
    });

    expect(result).toEqual({
      ok: true,
      marking: {
        why: 'Right idea, no pruning.',
        holds: true,
        right: ['you said it looks ahead'],
        missing: ['the networks narrowing it', 'a', 'b', 'c'],
        ownExample: true,
      },
      followUp: 'Why not search every move?',
      followUpExpected: 'Too many positions.',
    });
    expect(sent[0]!.model).toBe(TEACH_BACK_MODEL);
    expect(sent[0]!.tool_choice).toEqual({ type: 'tool', name: 'report_marking' });
    expect(sent[0]!.messages[0]!.content).toContain(`The claim: ${idea.claim}`);
    expect(sent[0]!.messages[0]!.content).toContain('What they wrote: It looks ahead');
    expect(spend).toHaveLength(1);
  });

  it('says so when the marking comes back without a follow-up', async () => {
    const { client } = stubClient([
      { type: 'tool_use', name: 'report_marking', input: { why: 'x', holds: true, right: [], missing: [] } },
    ]);
    const result = await markExplanation({ idea, prompt: 'p', response: 'r', anthropicApiKey: 'test', client });
    expect(result).toEqual({ ok: false, detail: 'The marking came back malformed.' });
  });
});

describe('marking the follow-up', () => {
  it('marks against the expected answer, with the explanation alongside', async () => {
    const { client, sent } = stubClient([
      {
        type: 'tool_use',
        name: 'report_follow_up_marking',
        input: { why: 'Named the branching.', holds: true, right: ['too many positions'], missing: [] },
      },
    ]);
    const result = await markFollowUp({
      idea,
      explanation: 'It looks ahead.',
      followUp: 'Why not search every move?',
      expected: 'Too many positions.',
      response: 'Because the game branches too much.',
      anthropicApiKey: 'test',
      client,
    });
    expect(result).toEqual({
      ok: true,
      marking: { why: 'Named the branching.', holds: true, right: ['too many positions'], missing: [] },
    });
    const content = sent[0]!.messages[0]!.content;
    expect(content).toContain('Their explanation of it: It looks ahead.');
    expect(content).toContain('Answer expected: Too many positions.');
  });

  it('never throws when the call fails', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Anthropic;
    const result = await markFollowUp({
      idea,
      explanation: 'e',
      followUp: 'f',
      expected: 'x',
      response: 'r',
      anthropicApiKey: 'test',
      client,
    });
    expect(result).toEqual({ ok: false, detail: 'overloaded' });
  });
});
