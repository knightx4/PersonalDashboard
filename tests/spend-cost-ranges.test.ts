/**
 * core.spend_cost_ranges, the ledger summary behind the $ hints (plan #915).
 *
 * What it has to get right is what a run is. A ledger row is one API call and
 * one press can make several, so rows of an operation written seconds apart
 * are one run, while a per-unit operation counts every row. And it reads only
 * the caller's rows, recent ones, with a known cost.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';

async function spend(userId: string, operation: string, cost: number | null, secondsAgo: number) {
  await admin`
    insert into model_spend (user_id, module, operation, model, cost_micros, created_at)
    values (${userId}, 'learn', ${operation}, 'claude-haiku-4-5', ${cost},
            now() - make_interval(secs => ${secondsAgo}))`;
}

type Range = { operation: string; runs: number; median_micros: string };

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('spend-a@example.com');
  userB = await createUser('spend-b@example.com');

  // Two presses of plan-topic, each two calls written a second apart.
  await spend(userA, 'plan-topic', 100, 3_600);
  await spend(userA, 'plan-topic', 200, 3_599);
  await spend(userA, 'plan-topic', 1_000, 60);
  await spend(userA, 'plan-topic', 1_000, 59);
  // Three items priced in the same second: three units, not one run.
  await spend(userA, 'estimate-resale-price', 10, 30);
  await spend(userA, 'estimate-resale-price', 20, 30);
  await spend(userA, 'estimate-resale-price', 30, 30);
  // Left out: unpriced, too old, and somebody else's.
  await spend(userA, 'estimate-resale-price', null, 30);
  await spend(userA, 'estimate-resale-price', 9_999, 40 * 86_400);
  await spend(userB, 'plan-topic', 50_000, 60);
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.spend_cost_ranges', () => {
  it('adds a press together and counts per-unit rows one by one', async () => {
    const rows = await asUser(userA, (tx) => tx<Range[]>`
      select operation, runs, median_micros::text
      from spend_cost_ranges(${userA}::uuid, array['plan-topic', 'estimate-resale-price'],
                             array['estimate-resale-price'])
      order by operation`);

    expect(rows).toEqual([
      { operation: 'estimate-resale-price', runs: 3, median_micros: '20' },
      // Runs of 300 and 2,000: the median of two is their mean.
      { operation: 'plan-topic', runs: 2, median_micros: '1150' },
    ]);
  });

  it('reads nothing of another account, even when asked for it by id', async () => {
    const rows = await asUser(userA, (tx) => tx<Range[]>`
      select operation, runs, median_micros::text
      from spend_cost_ranges(${userB}::uuid, array['plan-topic'])`);
    expect(rows).toEqual([]);
  });
});
