/**
 * The record of pages opened (plan #1481), against the database.
 *
 * Each person writes and reads only their own page views, core.page_opens
 * counts them per page, and the roll-up folds rows older than 180 days into
 * daily counts without losing any.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db-core';

let userA = '';
let userB = '';

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('page-views-a@example.com');
  userB = await createUser('page-views-b@example.com');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('a page view', () => {
  it('is written and read only by its owner', async () => {
    await asUser(userA, (tx) => tx`
      insert into page_views (user_id, route, workspace, via)
      values (${userA}, '/learn/s/[id]', 'learn', 'load'), (${userA}, '/goals', 'goals', 'navigation')`);

    await expect(
      asUser(userB, (tx) => tx`insert into page_views (user_id, route, via) values (${userA}, '/learn', 'load')`),
    ).rejects.toThrow();
    await expect(
      asUser(userA, (tx) => tx`insert into page_views (user_id, route, via) values (${userA}, 'learn', 'load')`),
    ).rejects.toThrow();

    expect(await asUser(userA, (tx) => tx`select id from page_views`)).toHaveLength(2);
    expect(await asUser(userB, (tx) => tx`select id from page_views`)).toHaveLength(0);
    expect(await asUser(userB, (tx) => tx`select route from page_opens`)).toHaveLength(0);
  });

  it('is counted per page over 7 and 30 days', async () => {
    await admin`
      insert into page_views (user_id, route, workspace, via, viewed_at)
      values (${userA}, '/learn/s/[id]', 'learn', 'load', now() - interval '10 days'),
             (${userA}, '/learn/s/[id]', 'learn', 'load', now() - interval '40 days')`;
    const rows = await asUser(userA, (tx) => tx<{ route: string; opens_7: number; opens_30: number }[]>`
      select route, opens_7, opens_30 from page_opens order by route`);
    expect(rows).toEqual([
      { route: '/goals', opens_7: 1, opens_30: 1 },
      { route: '/learn/s/[id]', opens_7: 1, opens_30: 2 },
    ]);
  });

  it('older than 180 days is folded into its day, and the day is added to on a second run', async () => {
    await admin`
      insert into page_views (user_id, route, workspace, via, viewed_at)
      values (${userA}, '/news', 'news', 'load', '2025-01-10T09:00:00Z'),
             (${userA}, '/news', 'news', 'navigation', '2025-01-10T18:00:00Z'),
             (${userB}, '/news', 'news', 'load', '2025-01-10T09:00:00Z')`;
    const [{ folded }] = await admin<{ folded: number }[]>`select core.roll_up_page_views() as folded`;
    expect(folded).toBe(3);

    await admin`
      insert into page_views (user_id, route, workspace, via, viewed_at)
      values (${userA}, '/news', 'news', 'load', '2025-01-10T20:00:00Z')`;
    await admin`select core.roll_up_page_views()`;

    const days = await admin<{ user_id: string; day: string; opens: number }[]>`
      select user_id, day::text as day, opens from page_view_days where route = '/news' order by opens`;
    expect(days).toEqual([
      { user_id: userB, day: '2025-01-10', opens: 1 },
      { user_id: userA, day: '2025-01-10', opens: 3 },
    ]);
    expect(await admin`select id from page_views where route = '/news'`).toHaveLength(0);

    const [news] = await asUser(userA, (tx) => tx<{ opens_30: number; last_opened: Date }[]>`
      select opens_30, last_opened from page_opens where route = '/news'`);
    expect(news.opens_30).toBe(0);
    expect(news.last_opened.toISOString()).toBe('2025-01-10T23:59:59.000Z');
  });

  it('cannot be rolled up by a signed-in person', async () => {
    await expect(asUser(userA, (tx) => tx`select core.roll_up_page_views()`)).rejects.toThrow();
  });
});
