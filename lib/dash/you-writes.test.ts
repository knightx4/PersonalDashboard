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

  it('puts a place it adds on the map from its city, and changes the position with the city', async () => {
    const tables: FakeTables = { 'you.places': [] };
    const added = await runYouWrite(write('add_place'), env(tables), {
      name: '12 Elm Street',
      city: 'Waco',
      region: 'TX',
      moved_in: '2016',
    });
    if ('ok' in added) throw new Error(added.error);
    expect(added.after).toMatchObject({ latitude: 31.55, longitude: -97.15 });

    const moved = await runYouWrite(write('change_place'), env(tables), {
      place_ref: String(added.after.id),
      city: 'Nowhere In Particular',
    });
    if ('ok' in moved) throw new Error(moved.error);
    expect(moved.after).toMatchObject({ latitude: null, longitude: null });
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

  describe('save_job', () => {
    const JOB = '22222222-2222-4222-8222-222222222222';
    const shop = (fields: Record<string, unknown> = {}) => ({
      id: JOB,
      user_id: ME,
      employer: 'Corner Bookshop',
      title: 'Shop assistant',
      place: null,
      started: '2014',
      ended: '2016',
      note: null,
      edited: false,
      ...fields,
    });

    it('adds a job as one they wrote', async () => {
      const tables: FakeTables = { 'you.work_history': [] };
      const result = await runYouWrite(write('save_job'), env(tables), {
        employer: 'Corner Bookshop',
        started: '2014',
        ended: '2016',
      });
      if ('ok' in result) throw new Error(result.error);
      expect(result.op).toBe('insert');
      expect(result.kind).toBe('save_job');
      expect(result.after).toMatchObject({ user_id: ME, employer: 'Corner Bookshop', started: '2014', ended: '2016', edited: true });
      expect(result.summary).toBe('Dash added the job at "Corner Bookshop", 2014 – 2016.');
    });

    it('needs an employer to add one', async () => {
      const result = await runYouWrite(write('save_job'), env({ 'you.work_history': [] }), { title: 'Cook' });
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/^employer: /) });
    });

    it('corrects a job by its ref, keeps the rest and marks it edited', async () => {
      const tables = { 'you.work_history': [shop()] };
      const result = await runYouWrite(write('save_job'), env(tables), { job_ref: JOB, ended: '2017' });
      if ('ok' in result) throw new Error(result.error);
      expect(result.op).toBe('update');
      expect(result.subjectRef).toBe(`you.work_history:${JOB}`);
      expect(result.before).toMatchObject({ ended: '2016', edited: false });
      expect(result.after).toMatchObject({ employer: 'Corner Bookshop', title: 'Shop assistant', started: '2014', ended: '2017', edited: true });
      expect(result.summary).toBe('Dash changed the job at "Corner Bookshop": ended.');
    });

    it('will not change somebody else’s job or send nothing to change', async () => {
      const theirs = { 'you.work_history': [shop({ user_id: OTHER })] };
      expect(await runYouWrite(write('save_job'), env(theirs), { job_ref: JOB, title: 'Boss' })).toEqual({
        ok: false,
        error: 'There is no job of theirs with that ref. Look it up first.',
      });
      const mine = { 'you.work_history': [shop()] };
      expect(await runYouWrite(write('save_job'), env(mine), { job_ref: JOB })).toEqual({
        ok: false,
        error: expect.stringMatching(/^Say what to change/),
      });
    });
  });
});
