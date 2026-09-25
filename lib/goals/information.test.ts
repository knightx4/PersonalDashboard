import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  askedFields,
  displayValue,
  formValues,
  informationProgress,
  inputValue,
  progressLine,
  sourceHref,
  sourceLabel,
  unfinishedReason,
} from '@/lib/goals/information';

const loans: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'due_day', label: 'Due day', type: 'day_of_month' },
  { key: 'notes', label: 'Notes', type: 'long_text' },
  { key: 'old', label: 'Old', type: 'text', removed: true },
];

const full = { name: 'Nelnet 1', balance: 18000, rate: 6.8, due_day: 15, notes: null };

describe('askedFields', () => {
  it('is every shown field when the step names none', () => {
    expect(askedFields(loans, null).map((f) => f.key)).toEqual([
      'name',
      'balance',
      'rate',
      'due_day',
      'notes',
    ]);
  });

  it('is the fields the step names, leaving out removed ones', () => {
    expect(askedFields(loans, ['balance', 'rate', 'old']).map((f) => f.key)).toEqual([
      'balance',
      'rate',
    ]);
  });

  it('falls back to the whole form when every named field has been removed', () => {
    expect(askedFields(loans, ['old'])).toHaveLength(5);
  });
});

describe('informationProgress', () => {
  const asked = askedFields(loans, ['name', 'balance', 'rate', 'due_day']);
  const questions = [
    { key: 'first_payment', question: 'When does my first payment fall due?' },
    { key: 'monthly_total', question: 'What is the monthly total?' },
  ];
  const source = [{ recordId: '00000000-0000-4000-8000-000000000001', asOf: '2026-09-02' }];
  const answer = (key: string, over: Partial<{ sources: typeof source; outOfDateAt: string | null }> = {}) => ({
    key,
    sources: source,
    outOfDateAt: null,
    ...over,
  });
  const filled = [
    { id: 'a', data: full, draft: false },
    { id: 'b', data: { ...full, name: 'Nelnet 2' }, draft: false },
  ];

  it('leaves the step open when every field is filled but a question has no answer', () => {
    const progress = informationProgress(asked, filled, questions, [answer('first_payment')]);
    expect(progress).toMatchObject({ unfilled: 0, drafts: 0, questions: 2, complete: false });
    expect(progress.open.map((q) => q.key)).toEqual(['monthly_total']);
    expect(unfinishedReason(progress)).toBe('Still to answer: \u201cWhat is the monthly total?\u201d');
    expect(progressLine('list', progress)).toBe('2 rows, 1 of 2 questions answered');
  });

  it('is complete once every question has an answer with sources, whatever the fields', () => {
    const progress = informationProgress(
      asked,
      [{ id: 'a', data: { name: 'x' }, draft: false }],
      questions,
      [answer('first_payment'), answer('monthly_total')],
    );
    expect(progress.complete).toBe(true);
    expect(unfinishedReason(progress)).toBeNull();
  });

  it('does not count an answer without sources or one out of date', () => {
    const progress = informationProgress(asked, filled, questions, [
      answer('first_payment', { sources: [] }),
      answer('monthly_total', { outOfDateAt: '2026-09-25T00:00:00Z' }),
    ]);
    expect(progress.open).toHaveLength(2);
    expect(unfinishedReason(progress)).toBe(
      'Still to answer: \u201cWhen does my first payment fall due?\u201d and \u201cWhat is the monthly total?\u201d',
    );
  });

  it('ignores answers to questions the step does not list', () => {
    const progress = informationProgress(asked, filled, questions.slice(0, 1), [
      answer('first_payment'),
      answer('daily_interest', { sources: [] }),
    ]);
    expect(progress.complete).toBe(true);
  });

  it('never completes a step with no questions', () => {
    const progress = informationProgress(asked, filled, [], []);
    expect(progress.complete).toBe(false);
    expect(unfinishedReason(progress)).toMatch(/^No questions yet/);
    expect(progressLine('list', progress)).toBe('2 rows');
  });

  it('counts drafts and gaps in the line', () => {
    const progress = informationProgress(
      asked,
      [
        { id: 'a', data: full, draft: true },
        { id: 'b', data: { name: 'x' }, draft: false },
        { id: 'c', data: { name: 'y' }, draft: false },
      ],
      [],
      [],
    );
    expect(progressLine('list', progress)).toBe('3 rows, 1 draft to confirm, 2 with gaps');
    expect(progressLine('one', informationProgress(asked, [], [], []))).toBe('Not filled in');
  });
});

describe('displayValue and inputValue', () => {
  const field = (key: string) => loans.find((f) => f.key === key) as CollectionField;

  it('shows each type in its own form', () => {
    expect(displayValue(field('balance'), 18000.5)).toBe('$18,000.50');
    expect(displayValue(field('rate'), 6.8)).toBe('6.8%');
    expect(displayValue(field('due_day'), 2)).toBe('2nd');
    expect(displayValue(field('due_day'), 23)).toBe('23rd');
    expect(displayValue({ key: 'd', label: 'D', type: 'date' }, '2026-09-24')).toBe('Sep 24, 2026');
    expect(displayValue({ key: 'y', label: 'Y', type: 'yes_no' }, false)).toBe('No');
    expect(displayValue(field('name'), null)).toBe('');
  });

  it('starts a yes or no input on its word', () => {
    expect(inputValue({ key: 'y', label: 'Y', type: 'yes_no' }, true)).toBe('yes');
    expect(inputValue(field('balance'), 18000)).toBe('18000');
    expect(inputValue(field('name'), undefined)).toBe('');
  });
});

describe('formValues', () => {
  it('reads only the shown fields, by their prefixed names', () => {
    const form = new Map<string, string>([
      ['v:name', 'Nelnet'],
      ['v:rate', '6.8%'],
      ['v:old', 'kept'],
      ['stepId', 'x'],
    ]);
    expect(formValues(loans, (name) => form.get(name) ?? null)).toEqual({
      name: 'Nelnet',
      rate: '6.8%',
    });
  });
});

describe('sourceHref', () => {
  it('links a Gmail message id, a stored document and a web address, and nothing else', () => {
    expect(sourceHref('gmail', '18c2f0a9b1')).toBe('https://mail.google.com/mail/u/0/#all/18c2f0a9b1');
    expect(sourceHref('document', 'u1/abc-statement.pdf')).toBe(
      '/goals/document?path=u1%2Fabc-statement.pdf',
    );
    expect(sourceHref('comment', 'c9')).toBeNull();
    expect(sourceHref('pasted', 'https://servicer.example/loans')).toBe('https://servicer.example/loans');
    expect(sourceHref('gmail', null)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('names the file a record came from, and the source otherwise', () => {
    expect(
      sourceLabel('document', 'u1/0b6f3c1e-8a2d-4f7b-9c1a-2d3e4f5a6b7c-May-statement.pdf'),
    ).toBe('From May-statement.pdf');
    expect(sourceLabel('document', null)).toBe('From a document');
    expect(sourceLabel('pasted', null)).toBe('From pasted text');
  });
});
