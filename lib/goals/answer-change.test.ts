import { describe, expect, it } from 'vitest';
import { answerChange, awaitsSeenIt, standingChange } from '@/lib/goals/answer-change';
import { readChanged, readClosed, readMeaning, readValue } from '@/lib/goals/answers';

// A loans step of the kind plan #1035's done-when describes.
const firstPayment = {
  answer: '18 Dec 2026, on both graduate loans.',
  value: { kind: 'date', date: '2026-12-18' } as const,
  closed: null,
  meaning: null,
};
const monthlyTotal = {
  answer: 'About $1,520 a month.',
  value: { kind: 'amount', amount: 1520 } as const,
  closed: null,
};

describe('answerChange (plan #1035)', () => {
  it('counts a start date moved by one day', () => {
    const change = answerChange(firstPayment, {
      answer: '19 Dec 2026, on both graduate loans.',
      value: { kind: 'date', date: '2026-12-19' },
    });
    expect(change.changed).toBe(true);
    expect(change.reason).toBe('The date moved from 18 Dec 2026 to 19 Dec 2026.');
  });

  it('does not count the same date reworded', () => {
    const change = answerChange(firstPayment, {
      answer: 'Payments start 18 Dec 2026.',
      value: { kind: 'date', date: '2026-12-18' },
    });
    expect(change.changed).toBe(false);
  });

  it('does not count a monthly total $10 higher', () => {
    const change = answerChange(monthlyTotal, {
      answer: 'About $1,530 a month.',
      value: { kind: 'amount', amount: 1530 },
    });
    expect(change.changed).toBe(false);
    expect(change.reason).toBe('The amount moved 0.7%, from $1,520 to $1,530, within the 5% margin.');
  });

  it('counts an amount past 5% and not one at exactly 5%', () => {
    const at = answerChange(monthlyTotal, { answer: 'x', value: { kind: 'amount', amount: 1596 } });
    expect(at.changed).toBe(false);
    const past = answerChange(monthlyTotal, { answer: 'x', value: { kind: 'amount', amount: 1596.01 } });
    expect(past.changed).toBe(true);
    const down = answerChange(monthlyTotal, { answer: 'x', value: { kind: 'amount', amount: 1400 } });
    expect(down.changed).toBe(true);
  });

  it('measures from the answer as it stood when the step last closed (#1047)', () => {
    // Three 2% rises since the step closed at $1,520: each within 5% of the
    // last, the third past 5% of what was seen.
    const stored = {
      answer: 'About $1,581 a month.',
      value: { kind: 'amount', amount: 1581 } as const,
      closed: { answer: 'About $1,520 a month.', value: { kind: 'amount', amount: 1520 } as const },
    };
    const change = answerChange(stored, { answer: 'About $1,613 a month.', value: { kind: 'amount', amount: 1613 } });
    expect(change.changed).toBe(true);
    expect(change.from).toBe('About $1,520 a month.');
  });

  it('counts any move from zero', () => {
    const zero = { answer: 'Nothing yet.', value: { kind: 'amount', amount: 0 } as const, closed: null };
    expect(answerChange(zero, { answer: 'x', value: { kind: 'amount', amount: 0 } }).changed).toBe(false);
    expect(answerChange(zero, { answer: 'x', value: { kind: 'amount', amount: 1 } }).changed).toBe(true);
  });

  it('judges a written answer by the routine’s verdict, and by wording without one', () => {
    const servicer = { answer: 'Northstar', value: { kind: 'text' } as const, closed: null };
    const same = answerChange(servicer, {
      answer: 'Northstar Servicing',
      value: { kind: 'text' },
      meaning: { changed: false, reason: 'The same servicer, named in full.' },
    });
    expect(same).toEqual({ changed: false, from: 'Northstar', reason: 'The same servicer, named in full.' });

    expect(answerChange(servicer, { answer: '  northstar ', value: { kind: 'text' } }).changed).toBe(false);
    expect(answerChange(servicer, { answer: 'Brightline', value: { kind: 'text' } }).changed).toBe(true);
  });
});

describe('reading the stored verdict (plan #1036)', () => {
  it('reads a verdict with its reason, and nothing without one', () => {
    expect(readMeaning(false, 'The same servicer.')).toEqual({ changed: false, reason: 'The same servicer.' });
    expect(readMeaning(null, null)).toBeNull();
    expect(readMeaning(true, '  ')).toBeNull();
  });
});

describe('reading the stored value', () => {
  it('reads a date, an amount from text or number, and falls back to text', () => {
    expect(readValue('date', '2026-12-18', null)).toEqual({ kind: 'date', date: '2026-12-18' });
    expect(readValue('amount', null, '1520.00')).toEqual({ kind: 'amount', amount: 1520 });
    expect(readValue('amount', null, 44)).toEqual({ kind: 'amount', amount: 44 });
    expect(readValue('amount', null, null)).toEqual({ kind: 'text' });
    expect(readValue('text', null, null)).toEqual({ kind: 'text' });
  });

  it('reads the closing state by whichever value is set', () => {
    expect(readClosed(null, null, null)).toBeNull();
    expect(readClosed('18 Dec', '2026-12-18', null)).toEqual({
      answer: '18 Dec',
      value: { kind: 'date', date: '2026-12-18' },
    });
    expect(readClosed('$1,520', null, '1520.00')?.value).toEqual({ kind: 'amount', amount: 1520 });
    expect(readClosed('Northstar', null, null)?.value).toEqual({ kind: 'text' });
  });
});

describe('standingChange (plan #997)', () => {
  const loan = '00000000-0000-4000-8000-000000000001';
  const records = [
    { id: loan, source: 'document' as const, sourceRef: 'user/11111111-2222-3333-4444-555555555555-nslds.txt' },
  ];

  it('shows the closing answer, what moved and the document behind it', () => {
    const change = standingChange(
      {
        answer: '18 Jan 2027, on both graduate loans.',
        value: { kind: 'date', date: '2027-01-18' },
        closed: { answer: firstPayment.answer, value: firstPayment.value },
        changed: { at: '2026-09-25T08:00:00Z', recordId: loan },
        meaning: null,
      },
      records,
    );
    expect(change).toEqual({
      from: firstPayment.answer,
      reason: 'The date moved from 18 Dec 2026 to 18 Jan 2027.',
      document: {
        label: 'From nslds.txt',
        href: `/goals/document?path=${encodeURIComponent(records[0].sourceRef)}`,
      },
    });
  });

  it('gives the routine’s reason for a changed servicer (plan #1036)', () => {
    const change = standingChange(
      {
        answer: 'Brightline',
        value: { kind: 'text' },
        closed: { answer: 'Northstar', value: { kind: 'text' } },
        changed: { at: '2026-09-25T08:00:00Z', recordId: loan },
        meaning: { changed: true, reason: 'The loans moved from Northstar to Brightline.' },
      },
      records,
    );
    expect(change?.from).toBe('Northstar');
    expect(change?.reason).toBe('The loans moved from Northstar to Brightline.');
  });

  it('is null without a change, and names no document for a row since gone', () => {
    expect(standingChange({ ...firstPayment, changed: null }, records)).toBeNull();
    const gone = standingChange(
      { ...firstPayment, changed: { at: '2026-09-25T08:00:00Z', recordId: null } },
      records,
    );
    expect(gone?.document).toBeNull();
  });

  it('reads the stored columns', () => {
    expect(readChanged(null, loan)).toBeNull();
    expect(readChanged('2026-09-25T08:00:00Z', loan)).toEqual({ at: '2026-09-25T08:00:00Z', recordId: loan });
    expect(readChanged('2026-09-25T08:00:00Z', 'nope')).toEqual({ at: '2026-09-25T08:00:00Z', recordId: null });
  });
});

describe('awaitsSeenIt (plan #1050)', () => {
  const moved = { changed: { at: '2026-09-26T09:00:00Z', recordId: null } };
  const still = { changed: null };

  it('offers Seen it on an open step with a changed answer', () => {
    expect(awaitsSeenIt('open', [still, moved])).toBe(true);
  });

  it('does not offer it when no answer changed', () => {
    expect(awaitsSeenIt('open', [still, still])).toBe(false);
    expect(awaitsSeenIt('open', [])).toBe(false);
  });

  it('does not offer it once the step is closed or put aside', () => {
    expect(awaitsSeenIt('done', [moved])).toBe(false);
    expect(awaitsSeenIt('blocked', [moved])).toBe(false);
  });
});
