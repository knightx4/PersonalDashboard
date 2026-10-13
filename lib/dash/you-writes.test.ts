import { describe, expect, it } from 'vitest';
import { YOU_CHANGE_KINDS } from '@/lib/ask/you-changes';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { runYouWrite, YOU_WRITES, type YouWriteEnv } from './you-writes';

/**
 * The places an agent records (plan #1991.5): one row each, scoped to the
 * person by its own filter, refused in the form's words.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const PLACE = '11111111-1111-4111-8111-111111111111';

function env(tables: FakeTables): YouWriteEnv {
  return { userId: ME, you: fakeSchemaDb(tables)('you') };
}

const write = (name: string) => YOU_WRITES.find((entry) => entry.name === name)!;

const leeds = (fields: Record<string, unknown> = {}) => ({
  id: PLACE,
  user_id: ME,
  name: 'Leeds',
  city: 'Leeds',
  region: null,
  country: 'UK',
  moved_in: '2015',
  moved_out: null,
  note: null,
  ...fields,
});

describe('the You writes', () => {
  it('are the kinds Ask keeps them under, in order', () => {
    expect(YOU_WRITES.map((entry) => entry.name)).toEqual([...YOU_CHANGE_KINDS]);
  });

  it('adds a place from rough dates', async () => {
    const tables: FakeTables = { 'you.places': [] };
    const result = await runYouWrite(write('add_place'), env(tables), {
      name: 'York',
      city: 'York',
      moved_in: 'March 2019',
    });
    if ('ok' in result) throw new Error(result.error);
    expect(result.op).toBe('insert');
    expect(result.after).toMatchObject({ user_id: ME, name: 'York', moved_in: '2019-03', moved_out: null });
    expect(result.summary).toBe('Dash added the place "York", lived in Mar 2019 to now.');
    expect(tables['you.places']).toHaveLength(1);
  });

  it('refuses a date it cannot read, naming the argument', async () => {
    const result = await runYouWrite(write('add_place'), env({ 'you.places': [] }), { name: 'York', moved_in: 'ages ago' });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^moved_in: /) });
  });

  it('changes only what it is sent, keeping the row as it was', async () => {
    const tables = { 'you.places': [leeds()] };
    const result = await runYouWrite(write('change_place'), env(tables), { place_ref: PLACE, moved_out: '2019-08' });
    if ('ok' in result) throw new Error(result.error);
    expect(result.op).toBe('update');
    expect(result.subjectRef).toBe(`you.places:${PLACE}`);
    expect(result.before).toMatchObject({ moved_out: null });
    expect(result.after).toMatchObject({ name: 'Leeds', moved_in: '2015', moved_out: '2019-08', country: 'UK' });
    expect(result.summary).toBe('Dash changed the place "Leeds": moved out.');
  });

  it('will not change somebody else’s place', async () => {
    const tables = { 'you.places': [leeds({ user_id: OTHER })] };
    const result = await runYouWrite(write('change_place'), env(tables), { place_ref: PLACE, name: 'Mine now' });
    expect(result).toEqual({ ok: false, error: 'There is no place of theirs with that ref. Look it up first.' });
  });
});
