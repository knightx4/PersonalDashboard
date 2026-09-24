import { describe, expect, it } from 'vitest';
import { aimPlace, cardDepthForAim, parseAimFields, toAim } from './aims';

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
    placed_at: null,
    archived_at: null,
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
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

describe('aimPlace', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  const open = {
    listSource: null,
    fieldId: null,
    domainId: null,
    placedAt: null,
    updatedAt: '2026-09-24T11:59:30Z',
  };
  const names = new Map([
    ['field-urban', 'Urban planning'],
    ['domain-society', 'Society'],
  ]);

  it('never places the Level 3 goal', () => {
    expect(aimPlace({ ...open, listSource: 'level3' }, names, now)).toEqual({ kind: 'list' });
  });

  it('names the field or domain a goal was placed in', () => {
    const placedAt = '2026-09-24T11:59:40Z';
    expect(aimPlace({ ...open, placedAt, fieldId: 'field-urban' }, names, now)).toEqual({
      kind: 'field',
      name: 'Urban planning',
    });
    expect(aimPlace({ ...open, placedAt, domainId: 'domain-society' }, names, now)).toEqual({
      kind: 'domain',
      name: 'Society',
    });
    expect(aimPlace({ ...open, placedAt }, names, now)).toEqual({ kind: 'spans' });
  });

  it('reads an unplaced goal as pending for two minutes after its save, then unplaced', () => {
    expect(aimPlace(open, names, now)).toEqual({ kind: 'pending' });
    expect(aimPlace({ ...open, updatedAt: '2026-09-24T11:57:00Z' }, names, now)).toEqual({
      kind: 'unplaced',
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
