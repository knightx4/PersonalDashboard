import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CollectionField } from '@/lib/goals/collections';
import {
  TILE_TYPES,
  TILES_MAX,
  checkLayout,
  parseLayout,
  tileLabel,
  tileProblem,
  type DashboardContext,
  type Tile,
} from '@/lib/goals/dashboard';

const LOANS = '11111111-1111-4111-8111-111111111111';
const ROOMS = '22222222-2222-4222-8222-222222222222';
const METRIC = '33333333-3333-4333-8333-333333333333';
const STEP_A = '44444444-4444-4444-8444-444444444444';
const STEP_B = '55555555-5555-4555-8555-555555555555';
const ELSEWHERE = '66666666-6666-4666-8666-666666666666';

const loanFields: CollectionField[] = [
  { key: 'name', label: 'Loan', type: 'text' },
  { key: 'rate', label: 'Rate', type: 'percent' },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'first_bill', label: 'First bill', type: 'date' },
  { key: 'autopay', label: 'Autopay on', type: 'yes_no' },
  { key: 'old', label: 'Old', type: 'number', removed: true },
];

const context: DashboardContext = {
  lists: [
    { id: LOANS, name: 'Loans', fields: loanFields },
    { id: ROOMS, name: 'Rooms', fields: [{ key: 'name', label: 'Room', type: 'text' }] },
  ],
  metrics: [{ id: METRIC, name: 'Applications' }],
  stepIds: new Set([STEP_A, STEP_B]),
};

/** The loans page from the approved mockup, one tile of each type. */
const loansLayout: Tile[] = [
  { type: 'number', title: 'Total owed', list: LOANS, field: 'balance' },
  { type: 'countdown', title: 'First bill', list: LOANS, field: 'first_bill' },
  { type: 'number', metric: METRIC },
  { type: 'tracker', title: 'Income-driven repayment', steps: [STEP_A, STEP_B] },
  { type: 'chart', title: 'Balance to zero', style: 'line', list: LOANS, field: 'balance' },
  { type: 'table', title: 'Loans', list: LOANS, fields: ['name', 'rate', 'balance', 'first_bill'] },
  { type: 'rooms' },
  { type: 'slots', list: ROOMS, count: 9 },
  { type: 'grid', list: LOANS, fields: ['name', 'autopay'] },
];

const refusal = (raw: unknown) => {
  const result = checkLayout(raw, context);
  if (result.ok) throw new Error('expected a refusal');
  return result;
};

describe('checkLayout', () => {
  it('passes a layout of every tile type and round-trips it through JSON unchanged', () => {
    const first = checkLayout(loansLayout, context);
    expect(first).toEqual({ ok: true, tiles: loansLayout });
    const stored = JSON.parse(JSON.stringify(first.ok && first.tiles));
    expect(checkLayout(stored, context)).toEqual(first);
  });

  it('reads null as no tiles, so a dashboard can be cleared', () => {
    expect(checkLayout(null, context)).toEqual({ ok: true, tiles: [] });
    expect(checkLayout([], context)).toEqual({ ok: true, tiles: [] });
  });

  it('trims a title and drops an empty one', () => {
    const result = checkLayout([{ type: 'rooms', title: '  Rooms  ' }, { type: 'rooms', title: ' ' }], context);
    expect(result).toEqual({ ok: true, tiles: [{ type: 'rooms', title: 'Rooms' }, { type: 'rooms' }] });
  });

  it('refuses a type outside the set, naming the tile', () => {
    const result = refusal([{ type: 'rooms' }, { type: 'pie', list: LOANS }]);
    expect(result.tile).toBe(1);
    expect(result.error).toBe('Tile 2: "pie" is not a tile type (number, countdown, chart, table, rooms, slots, tracker, grid).');
  });

  it('refuses a list that is not on the goal', () => {
    const result = refusal([{ type: 'rooms' }, { type: 'rooms' }, { type: 'table', list: ELSEWHERE }]);
    expect(result).toEqual({ ok: false, tile: 2, error: 'Tile 3 (table): the list it reads is not on this goal.' });
  });

  it('refuses a field the list does not have, and a removed one', () => {
    expect(refusal([{ type: 'table', list: LOANS, fields: ['name', 'lender'] }]).error).toBe(
      'Tile 1 (table): the list Loans has no field "lender".',
    );
    expect(refusal([{ type: 'grid', list: LOANS, fields: ['old'] }]).error).toBe(
      'Tile 1 (checklist grid): the list Loans has no field "old".',
    );
  });

  it('refuses a field of the wrong kind for the tile', () => {
    expect(refusal([{ type: 'number', list: LOANS, field: 'name' }]).error).toMatch(/Loan is not a number, money or percent field/);
    expect(refusal([{ type: 'countdown', list: LOANS, field: 'balance' }]).error).toMatch(/Balance is not a date field/);
    expect(refusal([{ type: 'chart', style: 'line', list: LOANS, field: 'rate' }]).error).toMatch(/Rate is not a tracked number/);
    expect(refusal([{ type: 'slots', list: LOANS, count: 4, field: 'name' }]).error).toMatch(/Loan is not a yes\/no field/);
  });

  it('refuses a metric or a step that is not on the goal', () => {
    expect(refusal([{ type: 'chart', style: 'bar', metric: ELSEWHERE }]).error).toBe(
      'Tile 1 (chart): the metric it reads is not on this goal.',
    );
    expect(refusal([{ type: 'countdown', step: ELSEWHERE }]).error).toMatch(/the step it counts down to is not on this goal/);
    expect(refusal([{ type: 'rooms', parent: ELSEWHERE }]).error).toMatch(/the parent step is not on this goal/);
    expect(refusal([{ type: 'tracker', steps: [STEP_A, ELSEWHERE] }]).error).toBe(
      'Tile 1 (tracker): step 2 of the tracker is not on this goal.',
    );
  });

  it('refuses a tile that names two sources, or none', () => {
    expect(refusal([{ type: 'number', metric: METRIC, list: LOANS }]).error).toBe(
      'Tile 1 (number): it names a metric and a list, and reads only one.',
    );
    expect(refusal([{ type: 'number' }]).error).toBe('Tile 1 (number): it needs a metric or a list.');
    expect(refusal([{ type: 'tracker' }]).error).toMatch(/it needs a list of steps or a parent step/);
    expect(refusal([{ type: 'countdown', list: LOANS }]).error).toMatch(/it needs the date field of the list/);
  });

  it('refuses a key the tile does not use, so a misspelling is caught', () => {
    expect(refusal([{ type: 'table', list: LOANS, feilds: ['name'] }]).error).toBe(
      'Tile 1 (table): it has "feilds", which a table tile does not use.',
    );
  });

  it('refuses a malformed layout as a whole', () => {
    expect(refusal({ type: 'rooms' })).toEqual({ ok: false, tile: null, error: 'The layout is not a list of tiles.' });
    const many = Array.from({ length: TILES_MAX + 1 }, () => ({ type: 'rooms' }));
    expect(refusal(many).tile).toBeNull();
    expect(refusal(['rooms']).error).toBe('Tile 1: it is not a tile.');
    expect(refusal([{ type: 'chart', metric: METRIC }]).error).toMatch(/its style is neither line nor bar/);
    expect(refusal([{ type: 'slots', list: ROOMS, count: 0 }]).error).toMatch(/its count is not a whole number/);
    expect(refusal([{ type: 'grid', list: LOANS }]).error).toMatch(/it names no fields/);
    expect(refusal([{ type: 'table', list: 'loans' }]).error).toMatch(/the list is not an id/);
  });
});

describe('tileProblem', () => {
  it('names what went missing in a saved layout, so the tile can draw its broken state', () => {
    const parsed = parseLayout(loansLayout);
    if (!parsed.ok) throw new Error('expected the layout to parse');
    const later: DashboardContext = { ...context, lists: [context.lists[1]] };
    expect(tileProblem(parsed.tiles[5], later)).toBe('the list it reads is not on this goal');
    expect(tileProblem(parsed.tiles[6], later)).toBeNull();
  });
});

describe('tileLabel', () => {
  it('counts from one and names a known type', () => {
    expect(tileLabel(0, 'grid')).toBe('Tile 1 (checklist grid)');
    expect(tileLabel(4, 'nope')).toBe('Tile 5');
  });
});

describe('the database check', () => {
  it('allows exactly the tile types this file does', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations-goals/0091_goal_dashboard.sql'), 'utf8');
    const list = /kind not in \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    const types = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(types).toEqual([...TILE_TYPES]);
    expect(sql).toContain(`> ${TILES_MAX} then`);
  });
});
