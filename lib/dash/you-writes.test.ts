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

  describe('save_about_me', () => {
    it('keeps what they said, in their words, for the insights runs', async () => {
      const tables: FakeTables = { 'you.claude_chats': [] };
      const result = await runYouWrite(write('save_about_me'), env(tables), {
        text: 'I only really finish when someone else is waiting on the last bit.',
        why: 'How they finish things.',
      });
      if ('ok' in result) throw new Error(result.error);
      expect(result.op).toBe('insert');
      expect(tables['you.claude_chats']).toEqual([
        expect.objectContaining({
          user_id: ME,
          origin: 'saved',
          body: 'I only really finish when someone else is waiting on the last bit.',
          why: 'How they finish things.',
        }),
      ]);
      expect(result.summary).toMatch(/^Dash saved "I only really finish/);
    });

    it('refuses a moment with no words of theirs', async () => {
      const tables: FakeTables = { 'you.claude_chats': [] };
      const result = await runYouWrite(write('save_about_me'), env(tables), { text: 'ok', why: 'x' });
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/text is missing/) });
      expect(tables['you.claude_chats']).toHaveLength(0);
    });
  });

  describe('set_detail', () => {
    const FIELD = '33333333-3333-4333-8333-333333333333';
    const mine = (custom_fields: unknown[]) => ({
      'you.details': [{ user_id: ME, phone: '555 0100', custom_fields }],
    });

    it('adds a field when no field has that label, leaving the six details alone', async () => {
      const tables = mine([{ id: FIELD, label: 'Shirt size', value: 'M' }]);
      const result = await runYouWrite(write('set_detail'), env(tables), { label: 'Passport', value: ' X123 ' });
      if ('ok' in result) throw new Error(result.error);
      expect(result.summary).toBe('Dash added the field "Passport".');
      const row = tables['you.details'][0] as { phone: string; custom_fields: { id: string; label: string; value: string }[] };
      expect(row.phone).toBe('555 0100');
      expect(row.custom_fields).toHaveLength(2);
      expect(row.custom_fields[0]).toEqual({ id: FIELD, label: 'Shirt size', value: 'M' });
      expect(row.custom_fields[1]).toMatchObject({ label: 'Passport', value: 'X123' });
      expect(row.custom_fields[1].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('creates their row when they have none yet', async () => {
      const tables: FakeTables = { 'you.details': [] };
      const result = await runYouWrite(write('set_detail'), env(tables), { label: 'Shirt size', value: 'L' });
      expect('ok' in result).toBe(false);
      expect(tables['you.details']).toHaveLength(1);
      expect(tables['you.details'][0]).toMatchObject({ user_id: ME, custom_fields: [{ label: 'Shirt size', value: 'L' }] });
    });

    it('matches a label whatever its capitals, keeping the id and the label as they wrote it', async () => {
      const tables = mine([{ id: FIELD, label: 'Shirt size', value: 'M' }]);
      const result = await runYouWrite(write('set_detail'), env(tables), { label: 'shirt SIZE', value: 'L' });
      if ('ok' in result) throw new Error(result.error);
      expect(result.summary).toBe('Dash set the field "Shirt size".');
      expect((tables['you.details'][0] as { custom_fields: unknown }).custom_fields).toEqual([
        { id: FIELD, label: 'Shirt size', value: 'L' },
      ]);
    });

    it('clears a value but never removes the field', async () => {
      const tables = mine([{ id: FIELD, label: 'Shirt size', value: 'M' }]);
      await runYouWrite(write('set_detail'), env(tables), { label: 'Shirt size', value: '' });
      expect((tables['you.details'][0] as { custom_fields: unknown }).custom_fields).toEqual([
        { id: FIELD, label: 'Shirt size', value: '' },
      ]);
    });

    it('refuses a missing label or value, and a thirty-first field', async () => {
      const tables = mine([]);
      expect(await runYouWrite(write('set_detail'), env(tables), { value: 'x' })).toEqual({
        ok: false,
        error: expect.stringMatching(/^label is missing/),
      });
      expect(await runYouWrite(write('set_detail'), env(tables), { label: 'x' })).toEqual({
        ok: false,
        error: expect.stringMatching(/^value is missing/),
      });
      const full = mine(Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, label: `Field ${i}`, value: 'v' })));
      expect(await runYouWrite(write('set_detail'), env(full), { label: 'One more', value: 'v' })).toEqual({
        ok: false,
        error: expect.stringContaining('the most'),
      });
    });

    it('does not touch another person’s row', async () => {
      const tables: FakeTables = { 'you.details': [{ user_id: OTHER, custom_fields: [{ id: FIELD, label: 'Shirt size', value: 'M' }] }] };
      await runYouWrite(write('set_detail'), env(tables), { label: 'Shirt size', value: 'XL' });
      expect(tables['you.details'].find((row) => row.user_id === OTHER)).toMatchObject({
        custom_fields: [{ id: FIELD, label: 'Shirt size', value: 'M' }],
      });
    });
  });
});
