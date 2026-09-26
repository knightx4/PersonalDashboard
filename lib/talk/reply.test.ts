import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { replyAbout, TALK_MODEL } from './reply';

/**
 * Dash's reply, with the model stubbed. What is tested is what the call is
 * sent and what happens to its answer.
 */

type Sent = {
  model: string;
  system: string;
  tool_choice: unknown;
  messages: { role: string; content: string }[];
};

function stubClient(content: unknown[], stop_reason = 'tool_use') {
  const sent: Sent[] = [];
  const client = {
    messages: {
      create: async (params: Sent) => {
        sent.push(params);
        return { content, stop_reason, usage: { input_tokens: 100, output_tokens: 20 } };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const subject = {
  kind: 'feed_card' as const,
  title: 'AlphaGo',
  material: 'AlphaGo combined a policy network with Monte Carlo tree search.',
};

describe('replyAbout', () => {
  it('sends the material and the thread, forces the tool, and reports the spend', async () => {
    const { client, sent } = stubClient([
      { type: 'tool_use', name: 'reply', input: { reply: '  The search only looks at moves the network rates.  ' } },
    ]);
    const spent: SpendReport[] = [];

    const result = await replyAbout({
      subject,
      turns: [{ role: 'user', body: 'Why does a tree search beat brute force here?' }],
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report),
    });

    expect(result).toEqual({ ok: true, reply: 'The search only looks at moves the network rates.' });
    expect(sent[0].model).toBe(TALK_MODEL);
    expect(sent[0].system).toContain('Monte Carlo tree search');
    expect(sent[0].system).toContain('Title: AlphaGo');
    expect(sent[0].tool_choice).toEqual({ type: 'tool', name: 'reply' });
    expect(sent[0].messages).toEqual([
      { role: 'user', content: 'Why does a tree search beat brute force here?' },
    ]);
    expect(spent).toHaveLength(1);
    expect(spent[0].model).toBe(TALK_MODEL);
  });

  it('adds the guidance a kind of exchange brings', async () => {
    const { client, sent } = stubClient([{ type: 'tool_use', name: 'reply', input: { reply: 'Close.' } }]);
    await replyAbout({
      subject,
      turns: [{ role: 'user', body: 'It searches.' }],
      guidance: 'MARK THE EXPLANATION.',
      anthropicApiKey: 'k',
      client,
    });
    expect(sent[0].system).toContain('MARK THE EXPLANATION.');
  });

  it('does not call the model when the last turn is not the person', async () => {
    const { client, sent } = stubClient([]);
    const result = await replyAbout({
      subject,
      turns: [
        { role: 'user', body: 'Why?' },
        { role: 'assistant', body: 'Because.' },
      ],
      anthropicApiKey: 'k',
      client,
    });
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('says why when there is no reply', async () => {
    const cut = stubClient([], 'max_tokens');
    const result = await replyAbout({
      subject,
      turns: [{ role: 'user', body: 'Why?' }],
      anthropicApiKey: 'k',
      client: cut.client,
    });
    expect(result).toEqual({ ok: false, detail: expect.stringContaining('cut off') });

    const empty = stubClient([{ type: 'tool_use', name: 'reply', input: { reply: '   ' } }]);
    expect(
      await replyAbout({ subject, turns: [{ role: 'user', body: 'Why?' }], anthropicApiKey: 'k', client: empty.client }),
    ).toEqual({ ok: false, detail: 'The reply came back empty.' });
  });

  it('returns a failure rather than throwing when the call fails', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Anthropic;
    expect(
      await replyAbout({ subject, turns: [{ role: 'user', body: 'Why?' }], anthropicApiKey: 'k', client }),
    ).toEqual({ ok: false, detail: 'overloaded' });
  });
});
