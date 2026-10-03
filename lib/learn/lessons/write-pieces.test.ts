import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { writePieces } from './write-pieces';

/**
 * Splitting a unit into pieces: a reply the schema refuses is sent back once
 * with the refusal, and the second reply is read.
 */

const usage = { input_tokens: 100, output_tokens: 70 };
const reply = (input: unknown, id = 'tool-1') => ({
  content: [{ type: 'tool_use', id, name: 'report_pieces', input }],
  usage,
  stop_reason: 'tool_use',
});

function stub(...replies: unknown[]) {
  const create = vi.fn();
  for (const one of replies) create.mockResolvedValueOnce(one);
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const UNIT = { title: 'Unit', covers: null, outcome: null };
const IDEAS = [
  { name: 'A', claim: 'a', buildsOn: [] },
  { name: 'B', claim: 'b', buildsOn: [1] },
];

describe('writePieces', () => {
  it('sends a refused reply back once with the refusal, and keeps the second', async () => {
    const { client, create } = stub(
      reply({ pieces: [{ title: 'One', ideas: ['first'] }] }),
      reply({ pieces: [{ title: 'One', ideas: [1] }, { title: 'Two', ideas: [2] }] }, 'tool-2'),
    );
    const spent: string[] = [];
    const result = await writePieces({
      trackName: 'T',
      unit: UNIT,
      ideas: IDEAS,
      anthropicApiKey: 'k',
      client,
      onSpend: (report) => spent.push(report.model),
    });

    expect(result).toEqual({ ok: true, pieces: [{ title: 'One', ideas: [1] }, { title: 'Two', ideas: [2] }] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(spent).toHaveLength(2);
    const second = create.mock.calls[1]![0] as { messages: { role: string; content: unknown }[] };
    expect(second.messages).toHaveLength(3);
    expect(second.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true }],
    });
    expect(JSON.stringify(second.messages[2])).toContain('pieces.0.ideas.0');
  });

  it('tries no more than twice, and does not retry a fault in what the reply says', async () => {
    const bad = reply({ pieces: [{ title: 'One', ideas: ['first'] }] });
    const twice = stub(bad, bad, bad);
    const result = await writePieces({ trackName: 'T', unit: UNIT, ideas: IDEAS, anthropicApiKey: 'k', client: twice.client });
    expect(result.ok).toBe(false);
    expect(twice.create).toHaveBeenCalledTimes(2);

    const onePiece = stub(reply({ pieces: [{ title: 'All', ideas: [1, 2] }] }));
    const counted = await writePieces({ trackName: 'T', unit: UNIT, ideas: IDEAS, anthropicApiKey: 'k', client: onePiece.client });
    expect(counted).toEqual({ ok: false, detail: 'The unit came back in 1 piece.' });
    expect(onePiece.create).toHaveBeenCalledTimes(1);
  });
});
