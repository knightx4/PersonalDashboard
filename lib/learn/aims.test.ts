import { describe, expect, it } from 'vitest';
import { cardDepthForAim, parseAimFields, toAim } from './aims';

describe('cardDepthForAim', () => {
  it('maps familiar, solid and deep to the card depths', () => {
    expect(cardDepthForAim('familiar')).toBe('working');
    expect(cardDepthForAim('solid')).toBe('advanced');
    expect(cardDepthForAim('deep')).toBe('specialist');
  });
});

describe('toAim', () => {
  const row = {
    id: 'a1',
    name: 'Every Level 3 vital article',
    about: null,
    depth: 'familiar',
    list_source: 'level3',
    field_id: null,
    domain_id: null,
    archived_at: null,
    created_at: '2026-09-24T00:00:00Z',
  };

  it('reads a list aim', () => {
    expect(toAim(row)).toMatchObject({ listSource: 'level3', depth: 'familiar' });
  });

  it('reads an unknown depth or list as the defaults', () => {
    expect(toAim({ ...row, depth: 'expert', list_source: 'other' })).toMatchObject({
      depth: 'familiar',
      listSource: null,
    });
  });
});

describe('parseAimFields', () => {
  const form = (values: Record<string, string>) => (key: string) => values[key] ?? null;

  it('reads a new goal and trims it', () => {
    expect(
      parseAimFields(form({ name: '  City design and urbanism ', about: ' ', depth: 'deep' })),
    ).toEqual({ ok: true, fields: { name: 'City design and urbanism', about: null, depth: 'deep' } });
  });

  it('defaults a new goal to familiar with no line', () => {
    expect(parseAimFields(form({ name: 'Startup finance' }))).toEqual({
      ok: true,
      fields: { name: 'Startup finance', about: null, depth: 'familiar' },
    });
  });

  it('refuses a blank name, a long name and an unknown depth', () => {
    expect(parseAimFields(form({ name: '   ' }))).toMatchObject({ ok: false });
    expect(parseAimFields(form({}))).toMatchObject({ ok: false });
    expect(parseAimFields(form({ name: 'x'.repeat(201) }))).toMatchObject({ ok: false });
    expect(parseAimFields(form({ name: 'FP&A', depth: 'expert' }))).toMatchObject({ ok: false });
    expect(parseAimFields(form({ name: 'FP&A', about: 'x'.repeat(1001) }))).toMatchObject({
      ok: false,
    });
  });

  it('reads only the fields an edit sends', () => {
    expect(parseAimFields(form({ depth: 'solid' }), { partial: true })).toEqual({
      ok: true,
      fields: { depth: 'solid' },
    });
    expect(parseAimFields(form({ about: '' }), { partial: true })).toEqual({
      ok: true,
      fields: { about: null },
    });
  });
});
