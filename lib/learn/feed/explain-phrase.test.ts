import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  checkedPhrase,
  EXPLAIN_MODEL,
  explainPhraseOnCard,
  explainPrompt,
  MAX_EXPLANATION,
  phraseOnCard,
  readExplanation,
} from './explain-phrase';

/**
 * Explaining a phrase selected on a Learn now card (plan #1057), with the
 * model stubbed.
 */

const card = {
  title: 'AlphaGo beat Lee Sedol',
  text: 'Takeaway: AlphaGo won by pairing\nneural networks with a tree search over moves.',
};

type Sent = { model: string; system: string; tool_choice: unknown; messages: { role: string; content: string }[] };

function stubClient(content: unknown[]) {
  const sent: Sent[] = [];
  const client = {
    messages: {
      create: async (params: Sent) => {
        sent.push(params);
        return { content, stop_reason: 'tool_use', usage: { input_tokens: 900, output_tokens: 150 } };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

describe('the phrase', () => {
  it('flattens whitespace and refuses nothing or a paragraph', () => {
    expect(checkedPhrase('  tree\n search ')).toEqual({ phrase: 'tree search' });
    expect(checkedPhrase('   ')).toHaveProperty('error');
    expect(checkedPhrase('word '.repeat(60))).toHaveProperty('error');
  });

  it('is on the card when it is in any of its texts, across a line break and in any case', () => {
    expect(phraseOnCard('Tree Search', [card.title, card.text])).toBe(true);
    expect(phraseOnCard('pairing neural networks', [card.text])).toBe(true);
    expect(phraseOnCard('self-play', [card.title, card.text])).toBe(false);
    expect(phraseOnCard('', [card.text])).toBe(false);
  });
});

describe('reading the explanation', () => {
  it('keeps the explanation and the article, and drops a section with no article', () => {
    expect(
      readExplanation({
        explanation: ' A tree search\n looks ahead. ',
        article: 'Monte Carlo tree search',
        section: 'Principle of operation',
      }),
    ).toEqual({
      explanation: 'A tree search looks ahead.',
      article: 'Monte Carlo tree search',
      section: 'Principle of operation',
    });
    expect(readExplanation({ explanation: 'Plain.', article: 'null', section: 'Lead' })).toEqual({
      explanation: 'Plain.',
      article: null,
      section: null,
    });
  });

  it('cuts a long one at a sentence and refuses an empty one', () => {
    const long = 'This sentence runs on. '.repeat(100);
    const read = readExplanation({ explanation: long, article: null, section: null });
    expect(typeof read).toBe('object');
    if (typeof read === 'object') {
      expect(read.explanation.length).toBeLessThanOrEqual(MAX_EXPLANATION);
      expect(read.explanation.endsWith('.')).toBe(true);
    }
    expect(typeof readExplanation({ explanation: '  ' })).toBe('string');
    expect(typeof readExplanation({})).toBe('string');
  });
});

describe('the call', () => {
  it('sends the phrase and the card, forces the tool, and reports the spend', async () => {
    const { client, sent } = stubClient([
      {
        type: 'tool_use',
        name: 'explain_phrase',
        input: {
          explanation: 'A tree search tries moves ahead. AlphaGo used one to pick its moves.',
          article: 'Monte Carlo tree search',
          section: null,
        },
      },
    ]);
    const spent: SpendReport[] = [];
    const result = await explainPhraseOnCard({
      phrase: 'tree search',
      card,
      anthropicApiKey: 'unused',
      client,
      onSpend: (report) => spent.push(report),
    });
    expect(result).toEqual({
      ok: true,
      explanation: 'A tree search tries moves ahead. AlphaGo used one to pick its moves.',
      article: 'Monte Carlo tree search',
      section: null,
    });
    expect(sent[0]!.model).toBe(EXPLAIN_MODEL);
    expect(sent[0]!.tool_choice).toMatchObject({ type: 'tool', name: 'explain_phrase' });
    expect(sent[0]!.messages[0]!.content).toBe(explainPrompt('tree search', card));
    expect(sent[0]!.messages[0]!.content).toContain('"tree search"');
    expect(sent[0]!.messages[0]!.content).toContain('AlphaGo beat Lee Sedol');
    expect(spent).toHaveLength(1);
    expect(spent[0]!.model).toBe(EXPLAIN_MODEL);
  });

  it('says why when there is no report, and does not throw when the call fails', async () => {
    const { client } = stubClient([{ type: 'text', text: 'Sure.' }]);
    expect(await explainPhraseOnCard({ phrase: 'x', card, anthropicApiKey: 'unused', client })).toMatchObject({
      ok: false,
    });
    const failing = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Anthropic;
    expect(await explainPhraseOnCard({ phrase: 'x', card, anthropicApiKey: 'unused', client: failing })).toEqual({
      ok: false,
      detail: 'overloaded',
    });
  });
});
