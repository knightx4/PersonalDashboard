import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { GOALS_WRITES, runGoalsWrite, type GoalsWriteEnv } from './goals-writes';

/**
 * change_goal_list (plan #2330.2): a goal's own lists and their rows, read by
 * id and the person's user id first, written as the person. A pasted product
 * link adds a draft with the page's name, picture and price.
 */

vi.mock('@/lib/saved/scrape-product', () => ({
  scrapeProductUrl: vi.fn(async (url: string) => {
    if (url.includes('localhost')) throw new Error('That host cannot be fetched.');
    if (url.includes('blank')) return { url, title: null, imageUrl: null, priceCents: null, currency: 'USD', source: 'none' };
    return {
      url,
      title: 'HOMCOM 72" Kitchen Pantry',
      imageUrl: 'https://cdn.example.com/homcom.jpg',
      priceCents: 18999,
      currency: 'USD',
      source: 'json_ld',
    };
  }),
}));

const ME = '00000000-0000-4000-8000-0000000000aa';
const THEM = '00000000-0000-4000-8000-0000000000bb';
const GOAL = '44444444-4444-4444-8444-444444444444';
const THEIR_GOAL = '55555555-5555-4555-8555-555555555555';
const STEP = '66666666-6666-4666-8666-666666666666';
const LIST = '77777777-7777-4777-8777-777777777777';

const item = (id: string, title: string, fields: Record<string, unknown> = {}) => ({
  id,
  user_id: ME,
  level: 'goal',
  parent_id: null,
  title,
  status: 'open',
  archived_at: null,
  ...fields,
});

function tables(): FakeTables {
  return {
    'goals.items': [
      item(GOAL, 'Get a pantry'),
      item(THEIR_GOAL, 'Not mine', { user_id: THEM }),
      item(STEP, 'Measure the wall', { level: 'step', parent_id: GOAL }),
    ],
    'goals.collections': [
      {
        id: LIST,
        user_id: ME,
        goal_id: GOAL,
        name: 'Pantries',
        shape: 'list',
        position: 0,
        version: 1,
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'link', label: 'Link', type: 'link' },
          { key: 'store', label: 'Store', type: 'place' },
        ],
        archived_at: null,
      },
    ],
    'goals.records': [],
  };
}

function env(data: FakeTables): GoalsWriteEnv {
  const goals = fakeSchemaDb(data)('goals');
  return {
    userId: ME,
    goals,
    write: async () => goals as unknown as GoalsSupabaseClient,
    today: '2026-10-17',
    timezone: 'UTC',
  };
}

const write = GOALS_WRITES.find((entry) => entry.name === 'change_goal_list')!;

async function made(data: FakeTables, input: Record<string, unknown>) {
  const result = await runGoalsWrite(write, env(data), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(data: FakeTables, input: Record<string, unknown>) {
  const result = await runGoalsWrite(write, env(data), input);
  if (!('ok' in result)) throw new Error(`expected a refusal, got ${result.summary}`);
  return result.error;
}

describe('change_goal_list', () => {
  it('is one of the Goals writes', () => {
    expect(write).toBeDefined();
  });

  it('refuses another account goal, and a step', async () => {
    const data = tables();
    expect(await refused(data, { change: 'add_list', goal_ref: THEIR_GOAL, name: 'Groups' })).toMatch(/no goal of theirs/);
    expect(await refused(data, { change: 'add_list', goal_ref: STEP, name: 'Groups' })).toMatch(/no goal of theirs/);
  });

  it('starts a list on the goal, after the ones it has, with a name, link and notes when no fields are given', async () => {
    const data = tables();
    const result = await made(data, { change: 'add_list', goal_ref: GOAL, name: 'Volunteer groups' });
    const list = data['goals.collections']!.find((c) => c.name === 'Volunteer groups')!;
    expect(list).toMatchObject({ user_id: ME, goal_id: GOAL, shape: 'list', position: 1 });
    expect((list.fields as { key: string }[]).map((f) => f.key)).toEqual(['name', 'link', 'notes']);
    expect(result.subjectRef).toBe(`goals.collections:${list.id}`);
    expect(result.summary).toBe('Dash started a list called "Volunteer groups" on the goal "Get a pantry".');
    expect(result.undo).toHaveProperty('none');
    expect(await refused(data, { change: 'add_list', goal_ref: GOAL, name: 'pantries' })).toMatch(/already/);
  });

  it('adds a row from values keyed by key or label, and refuses one that breaks its field', async () => {
    const data = tables();
    const result = await made(data, {
      change: 'add_row',
      goal_ref: GOAL,
      values: { Name: 'IKEA Bror', store: '1 Retail Park, Leeds' },
    });
    const row = data['goals.records']![0];
    expect(row).toMatchObject({
      collection_id: LIST,
      draft: false,
      source: 'typed',
      data: { name: 'IKEA Bror', store: { address: '1 Retail Park, Leeds' } },
    });
    expect(result.summary).toBe('Dash added "IKEA Bror, 1 Retail Park, Leeds" to the list "Pantries" on the goal "Get a pantry".');
    expect(await refused(data, { change: 'add_row', goal_ref: GOAL, values: { link: 'not a link' } })).toMatch(/web address/);
    expect(await refused(data, { change: 'add_row', goal_ref: GOAL, values: { colour: 'red' } })).toMatch(/no field "colour"/);
  });

  it('adds a draft from a pasted product link, with the name, picture and price, adding the fields it lacks', async () => {
    const data = tables();
    const result = await made(data, { change: 'add_link', goal_ref: GOAL, list: 'Pantries', link: 'https://shop.example.com/homcom' });
    const list = data['goals.collections']!.find((c) => c.id === LIST)!;
    expect((list.fields as { key: string; type: string }[]).map((f) => `${f.key}:${f.type}`)).toEqual([
      'name:text',
      'link:link',
      'store:place',
      'picture:image',
      'price:money',
    ]);
    const row = data['goals.records']![0];
    expect(row).toMatchObject({
      draft: true,
      source: 'pasted',
      source_ref: 'https://shop.example.com/homcom',
      data: {
        name: 'HOMCOM 72" Kitchen Pantry',
        picture: 'https://cdn.example.com/homcom.jpg',
        price: 189.99,
        link: 'https://shop.example.com/homcom',
      },
    });
    expect(result.op).toBe('insert');
    expect(result.summary).toBe('Dash added "HOMCOM 72" Kitchen Pantry, $189.99" to the list "Pantries" as a draft for them to confirm.');
  });

  it('says what a page did not give, and refuses a link the reader will not fetch', async () => {
    const data = tables();
    const result = await made(data, { change: 'add_link', goal_ref: GOAL, link: 'https://blank.example.com/x' });
    expect(result.summary).toMatch(/The page did not give the name, the picture and the price\.$/);
    expect(await refused(data, { change: 'add_link', goal_ref: GOAL, link: 'http://localhost/x' })).toBe('That host cannot be fetched.');
  });

  it('confirms a draft, changes a row, archives it and brings it back', async () => {
    const data = tables();
    await made(data, { change: 'add_link', goal_ref: GOAL, link: 'https://shop.example.com/homcom' });
    const row = data['goals.records']![0];

    await made(data, { change: 'confirm_row', goal_ref: GOAL, row: 'homcom' });
    expect(row.draft).toBe(false);
    expect(await refused(data, { change: 'confirm_row', goal_ref: GOAL, row: 'homcom' })).toBe('That row is confirmed already.');

    await made(data, { change: 'edit_row', goal_ref: GOAL, row: 'homcom', values: { price: '175' } });
    expect((row.data as Record<string, unknown>).price).toBe(175);

    await made(data, { change: 'archive_row', goal_ref: GOAL, row: 'homcom' });
    expect(row.archived_at).not.toBeNull();
    await made(data, { change: 'restore_row', goal_ref: GOAL, row: 'homcom' });
    expect(row.archived_at).toBeNull();
    expect(await refused(data, { change: 'archive_row', goal_ref: GOAL, row: 'ikea' })).toMatch(/No row matches "ikea"/);
  });

  it('renames a list, adds fields to it and archives it', async () => {
    const data = tables();
    await made(data, {
      change: 'add_fields',
      goal_ref: GOAL,
      list: 'Pantries',
      fields: [{ key: 'picked', label: 'Picked', type: 'yes_no' }],
    });
    const list = data['goals.collections']!.find((c) => c.id === LIST)!;
    expect((list.fields as unknown[]).length).toBe(4);
    await made(data, { change: 'rename_list', goal_ref: GOAL, list: 'pantries', name: 'Pantry candidates' });
    expect(list.name).toBe('Pantry candidates');
    expect(await refused(data, { change: 'archive_list', goal_ref: GOAL, list: 'Shelves' })).toMatch(/no list called "Shelves"/);
    await made(data, { change: 'archive_list', goal_ref: GOAL, list: 'Pantry candidates' });
    expect(list.archived_at).not.toBeNull();
  });
});
