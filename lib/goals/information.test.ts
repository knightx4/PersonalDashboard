import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  askedFields,
  closesOnSave,
  displayValue,
  formValues,
  informationProgress,
  inputValue,
  progressLine,
  sourceHref,
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

  it('completes a one-record collection on a confirmed, filled record', () => {
    const progress = informationProgress('one', asked, [{ id: 'a', data: full, draft: false }]);
    expect(progress.complete).toBe(true);
    expect(closesOnSave('one', progress)).toBe(true);
  });

  it('does not count a draft', () => {
    const progress = informationProgress('one', asked, [{ id: 'a', data: full, draft: true }]);
    expect(progress).toMatchObject({ drafts: 1, complete: false });
    expect(unfinishedReason(progress)).toBe('One row is a draft. Confirm or correct it first.');
  });

  it('does not count a record with an asked field empty', () => {
    const progress = informationProgress('one', asked, [
      { id: 'a', data: { ...full, rate: null }, draft: false },
    ]);
    expect(progress).toMatchObject({ unfilled: 1, complete: false });
  });

  it('never closes a list on a save, however full', () => {
    const progress = informationProgress('list', asked, [
      { id: 'a', data: full, draft: false },
      { id: 'b', data: { ...full, name: 'Nelnet 2' }, draft: false },
    ]);
    expect(progress.complete).toBe(true);
    expect(closesOnSave('list', progress)).toBe(false);
    expect(unfinishedReason(progress)).toBeNull();
  });

  it('says an empty list cannot be whole yet', () => {
    const progress = informationProgress('list', asked, []);
    expect(unfinishedReason(progress)).toBe('Add at least one row first.');
    expect(progressLine('list', progress)).toBe('0 rows');
  });

  it('counts drafts and gaps in the line', () => {
    const progress = informationProgress('list', asked, [
      { id: 'a', data: full, draft: true },
      { id: 'b', data: { name: 'x' }, draft: false },
      { id: 'c', data: { name: 'y' }, draft: false },
    ]);
    expect(progressLine('list', progress)).toBe('3 rows, 1 draft to confirm, 2 with gaps');
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
  it('links a Gmail message id and a web address, and nothing else', () => {
    expect(sourceHref('gmail', '18c2f0a9b1')).toBe('https://mail.google.com/mail/u/0/#all/18c2f0a9b1');
    expect(sourceHref('document', 'goals/abc/statement.pdf')).toBeNull();
    expect(sourceHref('pasted', 'https://servicer.example/loans')).toBe('https://servicer.example/loans');
    expect(sourceHref('gmail', null)).toBeNull();
  });
});
