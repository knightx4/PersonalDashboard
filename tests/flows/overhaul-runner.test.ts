/**
 * Flow: the overnight runner works a plain feature and leaves an overhaul to
 * its own routine (docs/SPEC-LAYER-SPEC.md Part 4).
 *
 * This is the first test in tests/flows/. A flow test runs one path across
 * several parts against the local database rather than one function with
 * hand-built rows, so a change that keeps every unit green but breaks the hand
 * between them still fails. Here the parts are the plan_items table and its
 * track default, the dependency rows, the row reader in lib/plan/load.ts, the
 * tree in lib/plan/tree.ts and the runner's chooser in
 * lib/plan/overnight-choice.ts. Each phase of an overhaul ends with a test
 * like this one (.claude/skills/plan/reference/overhaul.md), and the gate runs
 * this folder with the rest of tests/ (tests/flows-in-gate.test.ts keeps it
 * that way).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ITEM_COLUMNS, planItemFromRow, type PlanData } from '@/lib/plan/load';
import type { OvernightRun } from '@/lib/plan/overnight';
import { chooseOvernightFeature, readyFeatureCount } from '@/lib/plan/overnight-choice';
import { buildPlanTree, workOrder, type PlanSection } from '@/lib/plan/tree';
import { asUser, closeDb, createUser, truncateAll } from '../helpers/db';

const NOW = Date.parse('2026-10-03T23:00:00.000Z');

const night: OvernightRun = {
  id: 'run-1',
  running: true,
  paused: false,
  featuresBudget: 3,
  featuresLeft: 3,
  stopBy: '2026-10-04T07:00:00.000Z',
  startedAt: '2026-10-03T22:00:00.000Z',
  lastFiredAt: null,
  endedAt: null,
  endedReason: null,
  lastTickAt: null,
  lastTickNote: null,
  createdAt: '2026-10-03T22:00:00.000Z',
  updatedAt: '2026-10-03T22:00:00.000Z',
};

let person: string;

async function add(
  title: string,
  over: { parentId?: string; track?: 'overhaul'; position: number },
): Promise<string> {
  return asUser(person, async (tx) => {
    const [row] = over.track
      ? await tx<{ id: string }[]>`
          insert into plan_items (user_id, module, title, parent_id, track, position)
          values (${person}, 'shopping', ${title}, ${over.parentId ?? null}, ${over.track}, ${over.position})
          returning id`
      : await tx<{ id: string }[]>`
          insert into plan_items (user_id, module, title, parent_id, position)
          values (${person}, 'shopping', ${title}, ${over.parentId ?? null}, ${over.position})
          returning id`;
    return row.id;
  });
}

/** The plan as the page and the runner read it, from the database. */
async function readTree(): Promise<PlanSection[]> {
  const data = await asUser(person, async (tx): Promise<PlanData> => {
    const rows = await tx.unsafe(
      `select ${ITEM_COLUMNS} from plan_items where user_id = $1
       order by position, created_at, id`,
      [person],
    );
    const deps = await tx<{ id: string; item_id: string; depends_on_id: string }[]>`
      select id, item_id, depends_on_id from plan_dependencies where user_id = ${person}`;
    return {
      items: rows.map((row) => planItemFromRow(row as Record<string, unknown>)),
      dependencies: deps.map((d) => ({ id: d.id, itemId: d.item_id, dependsOnId: d.depends_on_id })),
    };
  });
  return buildPlanTree(data);
}

async function close(id: string): Promise<void> {
  await asUser(person, (tx) => tx`update plan_items set status = 'done' where id = ${id}`);
}

let feature: string;
let first: string;
let second: string;
let overhaul: string;
let overhaulStep: string;

beforeAll(async () => {
  await truncateAll();
  person = await createUser('flow-overhaul@example.com');
  // The overhaul sits first, so a runner that ignored the track would take it.
  overhaul = await add('Move every thread onto one table', { track: 'overhaul', position: 10 });
  overhaulStep = await add('Design the shared thread in code', { parentId: overhaul, position: 10 });
  feature = await add('Show prices in the list', { position: 20 });
  first = await add('Read the price', { parentId: feature, position: 10 });
  second = await add('Draw the price', { parentId: feature, position: 20 });
  await asUser(
    person,
    (tx) => tx`
      insert into plan_dependencies (user_id, item_id, depends_on_id)
      values (${person}, ${second}, ${first})`,
  );
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('the runner beside an overhaul', () => {
  it('reads a new feature as the feature track unless it was marked otherwise', async () => {
    const tree = await readTree();
    const tracks = new Map(workOrder(tree).map((node) => [node.id, node.track]));
    expect(tracks.get(first)).toBe('feature');
    expect(tracks.get(overhaulStep)).toBe('feature');
    const rows = await asUser(person, (tx) =>
      tx<{ id: string; track: string }[]>`select id, track from plan_items where id in (${feature}, ${overhaul})`,
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.track]))).toEqual({
      [feature]: 'feature',
      [overhaul]: 'overhaul',
    });
  });

  it('fires the plain feature, step by step, and never the overhaul', async () => {
    let tree = await readTree();
    expect(readyFeatureCount(tree)).toBe(1);
    let choice = chooseOvernightFeature(tree, night, NOW);
    expect(choice.act === 'fire' && [choice.feature.id, choice.step.id]).toEqual([feature, first]);

    // Closing the first step frees the one that waited on it.
    await close(first);
    tree = await readTree();
    choice = chooseOvernightFeature(tree, night, NOW);
    expect(choice.act === 'fire' && [choice.feature.id, choice.step.id]).toEqual([feature, second]);

    // With its steps closed, the feature itself is what is left to close.
    await close(second);
    tree = await readTree();
    choice = chooseOvernightFeature(tree, night, NOW);
    expect(choice.act === 'fire' && [choice.feature.id, choice.step.id]).toEqual([feature, feature]);

    // Once it is closed the runner has nothing, though the overhaul's step is
    // still ready for the overhaul's own routine.
    await close(feature);
    tree = await readTree();
    expect(readyFeatureCount(tree)).toBe(0);
    expect(chooseOvernightFeature(tree, night, NOW).act).toBe('end');
    expect(workOrder(tree).map((node) => node.id)).toEqual([overhaulStep]);
  });
});
