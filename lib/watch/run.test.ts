import { describe, expect, it } from 'vitest';
import type { PushPayload } from '@/lib/push/send';
import type { PriceReading } from '@/lib/watch/parse-price';
import {
  failureStreak,
  firedPayload,
  money,
  runWatches,
  shouldFire,
  type WatchPorts,
  type WatchReadingRow,
  type WatchRow,
} from './run';

const NOW = new Date('2026-10-01T14:23:00Z');

function watch(overrides: Partial<WatchRow> = {}): WatchRow {
  return {
    id: 'w1',
    user_id: 'u1',
    title: 'Jamie xx at Nowadays',
    url: 'https://www.crowdvolt.com/event/jamie-xx',
    reading: 'lowest_price',
    condition: { below: 200, currency: 'USD' },
    report_times: [],
    ends_at: '2026-10-10T00:00:00Z',
    status: 'running',
    fired_value: null,
    fired_at: null,
    reported_at: null,
    ...overrides,
  };
}

function ok(value: number): PriceReading {
  return {
    ok: true,
    value,
    detail: {
      source: 'crowdvolt',
      currency: 'USD',
      all_in: true,
      count: 9,
      listings: 6,
      high: 400,
      top_offer: 150,
      below: { threshold: 200, listings: 2, count: 3, cheapest: [] },
    },
  };
}

const broken: PriceReading = { ok: false, error: 'No price could be read from the page.' };

/**
 * An in-memory core.watches and core.watch_readings. Each run reads the
 * watch rows as they stand, so fired_value carries from one hour to the next.
 */
function fakeDb(rows: WatchRow[], reads: PriceReading[]) {
  const readings: WatchReadingRow[] = [];
  const pushes: { userId: string; payload: PushPayload }[] = [];
  const queue = [...reads];
  const ports: WatchPorts = {
    async running() {
      return rows.filter((row) => row.status === 'running').map((row) => ({ ...row }));
    },
    async read() {
      const next = queue.shift();
      if (!next) throw new Error('no reading queued');
      return next;
    },
    async saveReading(row) {
      readings.push(row);
    },
    async recent(w, limit) {
      return readings
        .filter((r) => r.watch_id === w.id)
        .reverse()
        .slice(0, limit);
    },
    async fired(w, value, at) {
      const row = rows.find((r) => r.id === w.id)!;
      row.fired_value = value;
      row.fired_at = at.toISOString();
    },
    async end(w) {
      const row = rows.find((r) => r.id === w.id)!;
      if (row.status === 'running') row.status = 'ended';
    },
    async push(userId, payload) {
      pushes.push({ userId, payload });
      return true;
    },
  };
  return { ports, readings, pushes, rows };
}

describe('shouldFire', () => {
  it('fires under the threshold, strictly', () => {
    expect(shouldFire(watch(), 186)).toBe(true);
    expect(shouldFire(watch(), 200)).toBe(false);
  });

  it('fires again only at a new low', () => {
    expect(shouldFire(watch({ fired_value: 186 }), 186)).toBe(false);
    expect(shouldFire(watch({ fired_value: 186 }), 190)).toBe(false);
    expect(shouldFire(watch({ fired_value: 186 }), 180)).toBe(true);
  });

  it('never fires a watch that only reports', () => {
    expect(shouldFire(watch({ condition: {} }), 1)).toBe(false);
  });
});

describe('failureStreak', () => {
  it('counts the errors before the latest good reading', () => {
    expect(failureStreak([{ error: 'x' }, { error: 'x' }, { error: null }, { error: 'x' }])).toBe(2);
    expect(failureStreak([{ error: null }])).toBe(0);
  });
});

describe('the notification', () => {
  it('names the price, the threshold and the watch within the lock-screen limits', () => {
    const payload = firedPayload(watch({ fired_value: 190 }), ok(186) as Extract<PriceReading, { ok: true }>);
    expect(payload.title).toBe('Under $200: Jamie xx at Nowadays');
    expect(payload.body).toBe(
      'Cheapest is now $186 all in. 2 listings under $200 (3 tickets). Down from $190 last time.',
    );
    expect(payload.url).toBe('/home#watching');
    expect(payload.tag).toBe('watch-w1');
  });

  it('writes other currencies after the amount', () => {
    expect(money(12.5, 'eur')).toBe('12.50 EUR');
    expect(money(186, 'USD')).toBe('$186');
  });
});

describe('runWatches', () => {
  it('sends one push when the condition is met, and none again at the same price', async () => {
    const db = fakeDb([watch()], [ok(186), ok(186), ok(195)]);
    await runWatches(db.ports, NOW);
    await runWatches(db.ports, new Date(NOW.getTime() + 3600_000));
    const third = await runWatches(db.ports, new Date(NOW.getTime() + 7200_000));

    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0].userId).toBe('u1');
    expect(db.rows[0].fired_value).toBe(186);
    expect(db.readings.map((r) => r.value)).toEqual([186, 186, 195]);
    expect(third.outcomes.read).toBe(1);
  });

  it('pushes again at a new low', async () => {
    const db = fakeDb([watch()], [ok(186), ok(170)]);
    await runWatches(db.ports, NOW);
    const second = await runWatches(db.ports, NOW);
    expect(db.pushes).toHaveLength(2);
    expect(second.outcomes.fired).toBe(1);
    expect(db.rows[0].fired_value).toBe(170);
  });

  it('stores a reading and sends nothing when the price is above the threshold', async () => {
    const db = fakeDb([watch()], [ok(250)]);
    const summary = await runWatches(db.ports, NOW);
    expect(summary.outcomes.read).toBe(1);
    expect(db.pushes).toHaveLength(0);
    expect(db.readings[0]).toMatchObject({ value: 250, error: null, watch_id: 'w1', user_id: 'u1' });
    expect(db.readings[0].detail).toMatchObject({ source: 'crowdvolt', top_offer: 150 });
  });

  it('ends a watch past its end time without reading it', async () => {
    const db = fakeDb([watch({ ends_at: '2026-10-01T14:00:00Z' })], []);
    const summary = await runWatches(db.ports, NOW);
    expect(summary.outcomes.ended).toBe(1);
    expect(db.rows[0].status).toBe('ended');
    expect(db.readings).toHaveLength(0);
    expect(await runWatches(db.ports, NOW)).toMatchObject({ watches: 0 });
  });

  it('turns a broken page into error readings and exactly one failure push', async () => {
    const db = fakeDb([watch()], [broken, broken, broken, broken, broken]);
    for (let hour = 0; hour < 5; hour++) await runWatches(db.ports, NOW);

    expect(db.readings.every((r) => r.value === null && r.error === broken.error)).toBe(true);
    expect(db.pushes).toHaveLength(1);
    expect(db.pushes[0].payload.title).toBe("Can't read: Jamie xx at Nowadays");
    expect(db.pushes[0].payload.body).toContain('No price could be read from the page.');
    expect(db.pushes[0].payload.tag).toBe('watch-w1-failing');
  });

  it('reports a page that breaks again after a good reading', async () => {
    const db = fakeDb([watch({ condition: {} })], [broken, broken, broken, ok(250), broken, broken, broken]);
    for (let hour = 0; hour < 7; hour++) await runWatches(db.ports, NOW);
    expect(db.pushes).toHaveLength(2);
  });

  it('keeps going when one watch fails to save', async () => {
    const db = fakeDb([watch(), watch({ id: 'w2' })], [ok(250), ok(250)]);
    const save = db.ports.saveReading;
    db.ports.saveReading = async (row) => {
      if (row.watch_id === 'w1') throw new Error('insert refused');
      return save(row);
    };
    const summary = await runWatches(db.ports, NOW);
    expect(summary.errors).toEqual(['w1: insert refused']);
    expect(summary.outcomes.read).toBe(1);
  });
});
