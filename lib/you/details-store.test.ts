import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { checkDetails, detailsFromRow, EMPTY_DETAILS } from './details';
import { getDetails, saveDetails } from './details-store';

/**
 * A one-table stand-in for the you schema's client: upsert merges into the row
 * kept for the person, select reads it back. Enough to show the store reads
 * and writes the way the table does (one row per person, a patch leaves the
 * other details alone).
 */
function fakeClient() {
  const rows = new Map<string, Record<string, unknown>>();
  const client = {
    from: (table: string) => {
      expect(table).toBe('details');
      let userId = '';
      let pending: Record<string, unknown> | null = null;
      const read = () => rows.get(userId) ?? null;
      const chain = {
        select: () => chain,
        eq: (_column: string, value: string) => {
          userId = value;
          return chain;
        },
        upsert: (row: Record<string, unknown>) => {
          pending = row;
          userId = String(row.user_id);
          rows.set(userId, { ...(rows.get(userId) ?? {}), ...row });
          return chain;
        },
        maybeSingle: async () => ({ data: read(), error: null }),
        single: async () => ({ data: pending ? read() : null, error: null }),
      };
      return chain;
    },
  };
  return { client: client as unknown as YouSupabaseClient, rows };
}

describe('details store', () => {
  it('reads six empty details before anything is saved', async () => {
    const { client } = fakeClient();
    expect(await getDetails(client, 'u1')).toEqual(EMPTY_DETAILS);
  });

  it('saves a detail, keeps one row per person, and reads it back', async () => {
    const { client, rows } = fakeClient();
    await saveDetails(client, 'u1', { phone: ' 555-0100 ', citizenship: 'Canadian' });
    const saved = await saveDetails(client, 'u1', { linkedin_url: 'https://linkedin.com/in/me' });
    expect(saved).toEqual({
      ...EMPTY_DETAILS,
      phone: '555-0100',
      citizenship: 'Canadian',
      linkedin_url: 'https://linkedin.com/in/me',
    });
    expect(rows.size).toBe(1);
    expect(await getDetails(client, 'u1')).toEqual(saved);
    expect(await getDetails(client, 'u2')).toEqual(EMPTY_DETAILS);
  });

  it('clears a detail saved blank and leaves the others', async () => {
    const { client } = fakeClient();
    await saveDetails(client, 'u1', { race: 'Asian', gender: 'Woman' });
    const after = await saveDetails(client, 'u1', { race: '   ' });
    expect(after).toEqual({ ...EMPTY_DETAILS, gender: 'Woman' });
  });

  it('refuses a detail that is too long, and writes nothing', async () => {
    const { client, rows } = fakeClient();
    await expect(saveDetails(client, 'u1', { phone: '5'.repeat(201) })).rejects.toThrow(/phone/);
    expect(rows.size).toBe(0);
    expect(checkDetails({ linkedin_url: 'x'.repeat(500) })).toBeNull();
  });

  it('reads a row with missing columns as empty details', () => {
    expect(detailsFromRow({ phone: '1' })).toEqual({ ...EMPTY_DETAILS, phone: '1' });
    expect(detailsFromRow(null)).toEqual(EMPTY_DETAILS);
  });

  it('saves own fields, trims them, and leaves them alone when the six are saved', async () => {
    const { client } = fakeClient();
    const saved = await saveDetails(client, 'u1', {
      custom_fields: [{ id: 'a', label: ' Pronouns ', value: ' she/her ' }, { id: 'b', label: 'Shirt', value: '' }],
    });
    expect(saved.custom_fields).toEqual([
      { id: 'a', label: 'Pronouns', value: 'she/her' },
      { id: 'b', label: 'Shirt', value: '' },
    ]);
    const after = await saveDetails(client, 'u1', { phone: '555' });
    expect(after.phone).toBe('555');
    expect(after.custom_fields).toEqual(saved.custom_fields);
    expect((await saveDetails(client, 'u1', { custom_fields: [] })).custom_fields).toEqual([]);
  });

  it('refuses bad lists and writes nothing', async () => {
    const { client, rows } = fakeClient();
    const f = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: 'L', value: 'v' }));
    expect(checkDetails({ custom_fields: f(30) })).toBeNull();
    expect(checkDetails({ custom_fields: f(31) })).toMatch(/at most 30/);
    expect(checkDetails({ custom_fields: 'x' })).toMatch(/list/);
    expect(checkDetails({ custom_fields: [{ id: 'a', label: '  ', value: '' }] })).toMatch(/name/);
    expect(checkDetails({ custom_fields: [{ id: 'a', label: 'x'.repeat(81), value: '' }] })).toMatch(/80/);
    expect(checkDetails({ custom_fields: [{ id: 'a', label: 'x'.repeat(80), value: 'y'.repeat(500) }] })).toBeNull();
    expect(checkDetails({ custom_fields: [{ id: 'a', label: 'x', value: 'y'.repeat(501) }] })).toMatch(/500/);
    expect(checkDetails({ custom_fields: [{ id: 'a', label: 'x', value: '' }, { id: 'a', label: 'y', value: '' }] })).toMatch(/share an id/);
    expect(checkDetails({ custom_fields: [{ id: 'a', label: 'x' }] })).toMatch(/value/);
    await expect(saveDetails(client, 'u1', { custom_fields: f(31) })).rejects.toThrow(/30/);
    expect(rows.size).toBe(0);
  });
});
