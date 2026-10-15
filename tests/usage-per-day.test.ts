/**
 * Page views and model spend per day in the person's timezone (plan #2036.2),
 * against the database: the day boundary is the timezone's midnight, each
 * person sees only their own rows, and the 7- and 30-day figures read over
 * the same days add up to the bars.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

const ZONE = 'America/New_York';
// Midnight on 10 October in New York.
const SINCE = '2026-10-10T04:00:00Z';

let userA = '';
let userB = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('usage-days-a@example.com');
  userB = await createUser('usage-days-b@example.com');
  await admin`
    insert into page_views (user_id, route, workspace, via, viewed_at)
    values (${userA}, '/home', null, 'load', '2026-10-11T03:30:00Z'),
           (${userA}, '/home', null, 'load', '2026-10-11T04:30:00Z'),
           (${userA}, '/goals', 'goals', 'load', '2026-10-11T05:00:00Z'),
           (${userA}, '/home', null, 'load', '2026-10-10T03:59:00Z'),
           (${userB}, '/home', null, 'load', '2026-10-11T05:00:00Z')`;
  await admin`
    insert into model_spend (user_id, module, operation, model, input_tokens, output_tokens, cost_micros, created_at)
    values (${userA}, 'core', 'ask-dash', 'm', 1, 1, 400000, '2026-10-12T03:00:00Z'),
           (${userA}, 'core', 'ask-dash', 'm', 1, 1, 250000, '2026-10-12T05:00:00Z'),
           (${userA}, 'learn', 'plan-topic', 'm', 1, 1, null, '2026-10-12T06:00:00Z'),
           (${userA}, 'learn', 'plan-topic', 'm', 1, 1, 900000, '2026-10-10T03:00:00Z')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('page views per day', () => {
  it('puts a view on the day it was in the timezone, and leaves out views before the window', async () => {
    const rows = await asUser(userA, (tx) => tx<{ day: string; views: number }[]>`
      select day::text as day, views from page_views_per_day(${ZONE}, ${SINCE}) order by day`);
    // 03:30 UTC on the 11th is the evening of the 10th in New York.
    expect(rows).toEqual([
      { day: '2026-10-10', views: 1 },
      { day: '2026-10-11', views: 2 },
    ]);
  });

  it('shows each person only their own', async () => {
    const rows = await asUser(userB, (tx) => tx<{ views: number }[]>`
      select views from page_views_per_day(${ZONE}, ${SINCE})`);
    expect(rows).toEqual([{ views: 1 }]);
  });

  it('adds up to the opens counted over the same window', async () => {
    const [total] = await asUser(userA, (tx) => tx<{ sum: number }[]>`
      select sum(opens_30)::integer as sum from page_opens_since(${SINCE}, ${SINCE})`);
    expect(total.sum).toBe(3);
  });
});

describe('model spend per day', () => {
  it('sums priced calls per day in the timezone and counts the unpriced apart', async () => {
    const rows = await asUser(userA, (tx) => tx<{ day: string; spend: string; calls: number; unpriced: number }[]>`
      select day::text as day, spend::text as spend, calls, unpriced
      from model_spend_per_day(${ZONE}, ${SINCE}) order by day`);
    expect(rows).toEqual([
      { day: '2026-10-11', spend: '400000', calls: 1, unpriced: 0 },
      { day: '2026-10-12', spend: '250000', calls: 2, unpriced: 1 },
    ]);
  });

  it('adds up to the spend per function over the same window', async () => {
    const rows = await asUser(userA, (tx) => tx<{ spend: string; calls: number; unpriced: number }[]>`
      select sum(spend_30)::text as spend, sum(calls_30)::integer as calls, sum(unpriced_30)::integer as unpriced
      from function_spend_since(${SINCE}, ${SINCE})`);
    expect(rows).toEqual([{ spend: '650000', calls: 3, unpriced: 1 }]);
  });

  it('shows nothing of anyone else', async () => {
    const rows = await asUser(userB, (tx) => tx`select * from model_spend_per_day(${ZONE}, ${SINCE})`);
    expect(rows).toHaveLength(0);
  });
});
