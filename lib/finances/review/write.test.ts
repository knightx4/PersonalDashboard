import { describe, expect, it } from 'vitest';
import type { MonthFacts } from './facts';
import { checkWording, cleanText, plainWording, reviewPrompt } from './write';

const facts: MonthFacts = {
  month: '2026-10',
  label: 'October 2026',
  plainSummary: 'In October you spent $400.00.',
  facts: [
    {
      id: 'spending',
      kind: 'spending',
      plain: 'You spent $400.00 in October across 2 charges, against $200.00 a month over the 2 months before.',
      figures: { spent: '$400.00', charges: '2', usual: '$200.00' },
      transactionIds: ['t1', 't2'],
      accountIds: [],
    },
    {
      id: 'due:card',
      kind: 'due',
      plain: 'Sapphire ··9012 is due on 7 November: $35.00 at least.',
      figures: { due_on: '7 November', minimum: '$35.00' },
      transactionIds: [],
      accountIds: ['card'],
    },
  ],
};

describe('checkWording', () => {
  it("keeps the model's lines whose numbers are the fact's own, with the fact's transactions", () => {
    const checked = checkWording(
      {
        summary: 'October cost $400.00 against a usual $200.00.',
        lines: [
          { fact: 'spending', text: 'You spent $400.00 over 2 charges, against a usual $200.00' },
          { fact: 'due:card', text: 'Your Sapphire ··9012 needs $35.00 by 7 November.' },
        ],
      },
      facts,
    );
    expect(checked.source).toBe('model');
    expect(checked.summary).toBe('October cost $400.00 against a usual $200.00.');
    expect(checked.lines).toEqual([
      {
        id: 'spending',
        kind: 'spending',
        text: 'You spent $400.00 over 2 charges, against a usual $200.00.',
        transaction_ids: ['t1', 't2'],
        account_ids: [],
      },
      {
        id: 'due:card',
        kind: 'due',
        text: 'Your Sapphire ··9012 needs $35.00 by 7 November.',
        transaction_ids: [],
        account_ids: ['card'],
      },
    ]);
  });

  it("falls back to the code's sentence for a line with a number of its own or a line left out", () => {
    const checked = checkWording(
      { summary: 'You spent 100% more than usual.', lines: [{ fact: 'spending', text: 'You spent $150.00 more than usual.' }] },
      facts,
    );
    expect(checked.lines.map((l) => l.text)).toEqual(facts.facts.map((f) => f.plain));
    expect(checked.summary).toBe(facts.plainSummary);
    expect(checked.source).toBe('plain');
    expect(checked.dropped).toEqual([
      { id: 'spending', reason: 'numbers' },
      { id: 'due:card', reason: 'missing' },
      { id: 'summary', reason: 'numbers' },
    ]);
  });

  it('stores the plain review when the model gave nothing back', () => {
    expect(checkWording(null, facts)).toEqual(plainWording(facts));
  });
});

describe('cleanText', () => {
  it('takes out dashes and exclamation marks and ends the line with a full stop', () => {
    expect(cleanText('Spending rose — mostly food!', 100)).toBe('Spending rose, mostly food.');
    expect(cleanText('   ', 100)).toBeNull();
    expect(cleanText('x'.repeat(20), 10)).toBeNull();
  });
});

describe('reviewPrompt', () => {
  it('gives each fact its id, sentence and figures', () => {
    const prompt = reviewPrompt(facts);
    expect(prompt).toContain('The month: October 2026.');
    expect(prompt).toContain('- id: due:card\n  kind: due\n  sentence: Sapphire ··9012 is due on 7 November: $35.00 at least.');
    expect(prompt).toContain('figures: due_on=7 November; minimum=$35.00');
  });
});
