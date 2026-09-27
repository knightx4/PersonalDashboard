import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  cleanSentence,
  CONNECTIONS_MODEL,
  openingOf,
  OPENING_CHARS,
  writeConnectionSentences,
  type ConnectionForModel,
} from '@/lib/vault/notes/connections-model';

/** The call's shape and what is kept of its answer; the model itself is not called. */

const groups: ConnectionForModel[] = [
  {
    older: { title: 'Money Changes Everything', opening: 'Goetzmann on how finance shaped civilisations.' },
    recent: [{ title: 'MGT 649 - World Financial History', opening: 'Week one: Mesopotamian loans.' }],
  },
  {
    older: { title: 'Songdo', opening: 'A city built from scratch near Incheon.' },
    recent: [{ title: 'ENAS 800 - Smart Cities', opening: 'Sensors, data and city services.' }],
  },
];

function fakeClient(input: unknown, calls: unknown[] = []) {
  return {
    messages: {
      create: async (body: unknown) => {
        calls.push(body);
        return {
          usage: { input_tokens: 900, output_tokens: 80 },
          content: [{ type: 'tool_use', name: 'write_sentences', id: 't1', input }],
        };
      },
    },
  } as unknown as Parameters<typeof writeConnectionSentences>[1]['client'];
}

describe('openingOf', () => {
  it('takes out embeds, links, formulas and formatting', () => {
    expect(
      openingOf('![[Pasted image.png]] [[Investor TA - Review Session]] ## Asset Allocation $$U = E - S^2$$ **risk** [site](https://x.y)'),
    ).toBe('Investor TA - Review Session Asset Allocation risk site');
    expect(openingOf('[[MGT 410 - Competitor|Competitor]] notes')).toBe('Competitor notes');
  });

  it('is cut to its length', () => {
    expect(openingOf('word '.repeat(400))).toHaveLength(OPENING_CHARS);
  });
});

describe('cleanSentence', () => {
  it('keeps one line, swaps a spaced dash for a comma and ends with a stop', () => {
    expect(cleanSentence('  Both notes look at money — how it began\n')).toBe('Both notes look at money, how it began.');
    expect(cleanSentence('Already done.')).toBe('Already done.');
    expect(cleanSentence('   ')).toBe('');
  });
});

describe('writeConnectionSentences', () => {
  it('returns a sentence per group in order and reports the cost', async () => {
    const calls: unknown[] = [];
    const spent: SpendReport[] = [];
    const out = await writeConnectionSentences(groups, {
      apiKey: 'k',
      client: fakeClient(
        {
          sentences: [
            { group: 2, sentence: 'Your smart cities course and your note on Songdo both look at a planned city run on data' },
            { group: 1, sentence: 'Both follow how lending and money grew up with the first cities.' },
          ],
        },
        calls,
      ),
      onSpend: (report) => spent.push(report),
    });
    expect(out).toEqual([
      'Both follow how lending and money grew up with the first cities.',
      'Your smart cities course and your note on Songdo both look at a planned city run on data.',
    ]);
    expect(spent).toHaveLength(1);
    expect(spent[0]!.model).toBe(CONNECTIONS_MODEL);
    const body = calls[0] as { messages: { content: string }[] };
    expect(body.messages[0]!.content).toContain('Older note: Money Changes Everything');
    expect(body.messages[0]!.content).toContain('Written this week: ENAS 800 - Smart Cities');
  });

  it('leaves a group without a sentence when the answer skips it or makes no sense', async () => {
    const out = await writeConnectionSentences(groups, {
      apiKey: 'k',
      client: fakeClient({ sentences: [{ group: 7, sentence: 'Out of range.' }, { group: 1, sentence: '' }] }),
    });
    expect(out).toEqual([null, null]);
  });

  it('gives nulls when the call fails, and makes no call for no groups', async () => {
    const failing = {
      messages: {
        create: async () => {
          throw new Error('down');
        },
      },
    } as unknown as Parameters<typeof writeConnectionSentences>[1]['client'];
    expect(await writeConnectionSentences(groups, { apiKey: 'k', client: failing })).toEqual([null, null]);
    expect(await writeConnectionSentences([], { apiKey: 'k', client: failing })).toEqual([]);
  });
});
