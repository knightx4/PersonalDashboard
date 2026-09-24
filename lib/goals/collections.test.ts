import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  checkRecord,
  fieldsError,
  liveFields,
  parseCollectionName,
  parseFieldValue,
  revisionError,
  trackedChanges,
  type CollectionField,
  type FieldType,
} from './collections';

const field = (type: FieldType, extra: Partial<CollectionField> = {}): CollectionField => ({
  key: 'value',
  label: 'Value',
  type,
  ...extra,
});

const ok = (type: FieldType, raw: unknown, extra: Partial<CollectionField> = {}) => {
  const parsed = parseFieldValue(field(type, extra), raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};

const refused = (type: FieldType, raw: unknown, extra: Partial<CollectionField> = {}) => {
  const parsed = parseFieldValue(field(type, extra), raw);
  return parsed.ok ? null : parsed.error;
};

const loans: CollectionField[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'servicer', label: 'Servicer', type: 'text' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'minimum', label: 'Minimum', type: 'money' },
  { key: 'due_day', label: 'Due day', type: 'day_of_month' },
];

describe('field values', () => {
  it('has a test below for every type', () => {
    expect(FIELD_TYPES).toHaveLength(10);
  });

  it('takes empty as null for every type', () => {
    for (const type of FIELD_TYPES) {
      const extra = type === 'choice' ? { options: ['A'] } : {};
      expect(ok(type, '', extra)).toBeNull();
      expect(ok(type, '   ', extra)).toBeNull();
      expect(ok(type, null, extra)).toBeNull();
      expect(ok(type, undefined, extra)).toBeNull();
    }
  });

  it('text: one trimmed line up to 500 characters', () => {
    expect(ok('text', '  Nelnet ')).toBe('Nelnet');
    expect(refused('text', 'two\nlines')).toBe('Value must be one line of text, up to 500 characters.');
    expect(refused('text', 'x'.repeat(501))).not.toBeNull();
    expect(refused('text', 12)).not.toBeNull();
  });

  it('long text: keeps line breaks, up to 20000 characters', () => {
    expect(ok('long_text', 'first\n\nsecond')).toBe('first\n\nsecond');
    expect(refused('long_text', 'x'.repeat(20001))).toBe('Value must be text of up to 20000 characters.');
  });

  it('number: as a person types it', () => {
    expect(ok('number', '1,250')).toBe(1250);
    expect(ok('number', -3.5)).toBe(-3.5);
    expect(refused('number', 'twelve')).toBe('Value must be a number.');
    expect(refused('number', 1e13)).not.toBeNull();
  });

  it('money: to the cent, with a sign and separators allowed', () => {
    expect(ok('money', '$18,250.40')).toBe(18250.4);
    expect(ok('money', 212)).toBe(212);
    expect(refused('money', '18.255')).toBe('Value must be an amount of money, to the cent.');
    expect(refused('money', 'lots')).not.toBeNull();
  });

  it('percent: with or without the sign, 6.8 for 6.8%', () => {
    expect(ok('percent', '6.8%')).toBe(6.8);
    expect(ok('percent', '5.05')).toBe(5.05);
    expect(ok('percent', 0)).toBe(0);
    expect(refused('percent', '1001')).toBe('Value must be a percentage.');
    expect(refused('percent', 'high')).not.toBeNull();
  });

  it('date: a real calendar day, YYYY-MM-DD', () => {
    expect(ok('date', '2026-10-15')).toBe('2026-10-15');
    expect(refused('date', '2026-02-30')).toBe('Value must be a date.');
    expect(refused('date', '10/15/2026')).not.toBeNull();
  });

  it('day of month: 1 to 31, "15th" allowed', () => {
    expect(ok('day_of_month', '15')).toBe(15);
    expect(ok('day_of_month', '1st')).toBe(1);
    expect(ok('day_of_month', 31)).toBe(31);
    expect(refused('day_of_month', '32')).toBe('Value must be a day of the month, 1 to 31.');
    expect(refused('day_of_month', 0)).not.toBeNull();
    expect(refused('day_of_month', 2.5)).not.toBeNull();
  });

  it('yes/no: a boolean, or the words for one', () => {
    expect(ok('yes_no', true)).toBe(true);
    expect(ok('yes_no', 'Yes')).toBe(true);
    expect(ok('yes_no', 'on')).toBe(true);
    expect(ok('yes_no', 'no')).toBe(false);
    expect(refused('yes_no', 'maybe')).toBe('Value must be yes or no.');
  });

  it('choice: one of the options, matched without regard to case', () => {
    const options = { options: ['Federal', 'Private'] };
    expect(ok('choice', 'Federal', options)).toBe('Federal');
    expect(ok('choice', 'private', options)).toBe('Private');
    expect(refused('choice', 'State', options)).toBe('Value must be one of its options.');
  });

  it('link: an http or https address', () => {
    expect(ok('link', 'https://studentaid.gov/')).toBe('https://studentaid.gov/');
    expect(refused('link', 'studentaid.gov')).toBe(
      'Value must be a web address starting http:// or https://.',
    );
    expect(refused('link', 'javascript:alert(1)')).not.toBeNull();
  });
});

describe('checkRecord', () => {
  it('stores what was typed in its own form', () => {
    const result = checkRecord(
      loans,
      { name: 'Loan 1', servicer: 'Nelnet', balance: '$18,250.40', rate: '6.8%', minimum: '212', due_day: '15' },
      null,
    );
    expect(result).toEqual({
      ok: true,
      data: { name: 'Loan 1', servicer: 'Nelnet', balance: 18250.4, rate: 6.8, minimum: 212, due_day: 15 },
    });
  });

  it('refuses a value that breaks its field, naming the field', () => {
    expect(checkRecord(loans, { name: 'Loan 1', rate: 'about seven' }, null)).toEqual({
      ok: false,
      field: 'rate',
      error: 'Rate must be a percentage.',
    });
  });

  it('refuses a key the definition does not have', () => {
    const result = checkRecord(loans, { colour: 'blue' }, null);
    expect(result).toMatchObject({ ok: false, field: 'colour' });
  });

  it('keeps values the write does not mention, including a removed field', () => {
    const revised = loans.map((f) => (f.key === 'servicer' ? { ...f, removed: true } : f));
    const previous = { name: 'Loan 1', servicer: 'Nelnet', balance: 18250.4 };
    const result = checkRecord(revised, { balance: '18,000' }, previous);
    expect(result).toEqual({ ok: true, data: { name: 'Loan 1', servicer: 'Nelnet', balance: 18000 } });
  });

  it('refuses a new value for a removed field, but lets the old one through unchanged', () => {
    const revised = loans.map((f) => (f.key === 'servicer' ? { ...f, removed: true } : f));
    const previous = { servicer: 'Nelnet' };
    expect(checkRecord(revised, { servicer: 'Mohela' }, previous)).toMatchObject({ ok: false, field: 'servicer' });
    expect(checkRecord(revised, { servicer: 'Nelnet' }, previous)).toMatchObject({ ok: true });
  });

  it('does not re-check a value kept from an earlier version', () => {
    const fields: CollectionField[] = [{ key: 'kind', label: 'Kind', type: 'choice', options: ['Private'] }];
    // "Federal" was an option when this was written, and has since been taken off.
    const result = checkRecord(fields, { kind: 'Federal' }, { kind: 'Federal' });
    expect(result).toEqual({ ok: true, data: { kind: 'Federal' } });
  });
});

describe('trackedChanges', () => {
  it('lists the tracked fields a write gives a new value', () => {
    expect(trackedChanges(loans, null, { balance: 18250.4, minimum: 212 })).toEqual([
      { key: 'balance', value: 18250.4 },
    ]);
    expect(trackedChanges(loans, { balance: 18250.4 }, { balance: 18250.4 })).toEqual([]);
    expect(trackedChanges(loans, { balance: 18250.4 }, { balance: 18000 })).toEqual([
      { key: 'balance', value: 18000 },
    ]);
    expect(trackedChanges(loans, { balance: 18250.4 }, { balance: null })).toEqual([]);
  });
});

describe('definitions', () => {
  it('accepts the loans definition', () => {
    expect(fieldsError(loans)).toBeNull();
  });

  it('refuses a type the app does not know, a bad key and a repeated key', () => {
    expect(fieldsError([{ key: 'x', label: 'X', type: 'currency' }])).toMatch(/no type the app knows/);
    expect(fieldsError([{ key: 'Due Day', label: 'Due day', type: 'text' }])).toMatch(/lower case/);
    expect(fieldsError([loans[0], loans[0]])).toMatch(/used twice/);
  });

  it('tracks only numbers, money and percents', () => {
    expect(fieldsError([{ key: 'n', label: 'N', type: 'text', tracked: true }])).toMatch(/can be tracked/);
    expect(fieldsError([{ key: 'n', label: 'N', type: 'percent', tracked: true }])).toBeNull();
  });

  it('gives options to choice fields only, and requires them there', () => {
    expect(fieldsError([{ key: 'c', label: 'C', type: 'choice' }])).toMatch(/needs a list/);
    expect(fieldsError([{ key: 'c', label: 'C', type: 'choice', options: ['A', 'A'] }])).toMatch(/twice/);
    expect(fieldsError([{ key: 't', label: 'T', type: 'text', options: ['A'] }])).toMatch(/only a choice/);
  });

  it('never takes a field out or changes its type on revision', () => {
    const removed = loans.map((f) => (f.key === 'servicer' ? { ...f, removed: true } : f));
    expect(revisionError(loans, [...removed, { key: 'notes', label: 'Notes', type: 'long_text' }])).toBeNull();
    expect(revisionError(loans, loans.slice(1))).toMatch(/cannot be taken out/);
    expect(
      revisionError(loans, loans.map((f) => (f.key === 'rate' ? { ...f, type: 'number' as const } : f))),
    ).toMatch(/stays percent/);
    expect(liveFields(removed).map((f) => f.key)).not.toContain('servicer');
  });

  it('needs a name for the collection', () => {
    expect(parseCollectionName('  Loans ')).toEqual({ ok: true, value: 'Loans' });
    expect(parseCollectionName('')).toMatchObject({ ok: false });
  });
});
