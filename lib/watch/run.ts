/**
 * The hourly check of every running watch (plan #1293).
 *
 * For each watch with status 'running':
 *
 *   - Past its ends_at, it is ended and not read again.
 *   - Otherwise its page is read once (lib/watch/read-price.ts) and the
 *     reading is stored, as a value with its detail or as an error.
 *   - A value under the condition's `below` fires the watch when it is a new
 *     low: nothing fired yet, or under the value it last fired at. The watch
 *     keeps that value in fired_value, so the same price never pushes twice.
 *   - A read that fails makes the third failure in a row send one push
 *     saying the page cannot be read. The fourth and later stay quiet, and a
 *     good reading resets the count, so a page that breaks again later is
 *     reported again.
 *
 * The trend report at the watch's report times (#1294) belongs in
 * `checkWatch`, after the reading is stored.
 *
 * Pure: the database, the fetch and the push are ports, wired in
 * inngest/core/watches.ts.
 */

import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from '@/lib/push/send';
import type { PriceReading } from '@/lib/watch/parse-price';

export type WatchCondition = { below?: number; currency?: string };

/** The columns of core.watches the run reads. */
export type WatchRow = {
  id: string;
  user_id: string;
  title: string;
  url: string;
  reading: string;
  condition: WatchCondition;
  report_times: string[];
  ends_at: string;
  status: string;
  fired_value: number | null;
  fired_at: string | null;
  reported_at: string | null;
};

/** One row for core.watch_readings: exactly one of value and error is set. */
export type WatchReadingRow = {
  watch_id: string;
  user_id: string;
  taken_at: string;
  value: number | null;
  detail: Record<string, unknown>;
  error: string | null;
};

export type WatchPorts = {
  /** Every watch with status 'running', for every person. */
  running(): Promise<WatchRow[]>;
  read(watch: WatchRow): Promise<PriceReading>;
  saveReading(row: WatchReadingRow): Promise<void>;
  /** The watch's latest readings, newest first, at most `limit`. */
  recent(watch: WatchRow, limit: number): Promise<{ error: string | null }[]>;
  /** Records that the watch fired at this value. */
  fired(watch: WatchRow, value: number, at: Date): Promise<void>;
  /** Sets status 'ended', only while it is still 'running'. */
  end(watch: WatchRow, at: Date): Promise<void>;
  /** Sends to every device the person switched push on for; false when none could be reached. */
  push(userId: string, payload: PushPayload): Promise<boolean>;
};

export type WatchOutcome = 'ended' | 'read' | 'fired' | 'failed' | 'failing' | 'skipped';

export type WatchesSummary = {
  watches: number;
  outcomes: Record<WatchOutcome, number>;
  pushes: number;
  errors: string[];
};

/** Failed reads in a row that send the one failure push. */
export const FAILURES_BEFORE_PUSH = 3;

/** Pages read at the same time; each read gives up after ten seconds. */
const CONCURRENCY = 4;

/** Where a watch notification opens: the home page's Watching section (#1295). */
export const WATCH_URL = '/home#watching';

export function belowOf(condition: WatchCondition | null | undefined): number | null {
  const below = condition?.below;
  return typeof below === 'number' && Number.isFinite(below) && below > 0 ? below : null;
}

/** Whether this value fires the watch: under the threshold and a new low. */
export function shouldFire(watch: Pick<WatchRow, 'condition' | 'fired_value'>, value: number): boolean {
  const below = belowOf(watch.condition);
  if (below === null || !(value < below)) return false;
  return watch.fired_value === null || value < watch.fired_value;
}

/** Leading errors in readings listed newest first. */
export function failureStreak(recent: { error: string | null }[]): number {
  let streak = 0;
  for (const reading of recent) {
    if (reading.error === null) break;
    streak += 1;
  }
  return streak;
}

/** A value as money: "$186" for dollars, "186 EUR" otherwise. */
export function money(value: number, currency: string | null | undefined): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  const code = (currency ?? 'USD').toUpperCase();
  return code === 'USD' ? `$${amount}` : `${amount} ${code}`;
}

export function firedPayload(
  watch: Pick<WatchRow, 'id' | 'title' | 'condition' | 'fired_value'>,
  reading: Extract<PriceReading, { ok: true }>,
): PushPayload {
  const currency = reading.detail.currency || watch.condition.currency;
  const below = belowOf(watch.condition)!;
  const parts = [`Cheapest is now ${money(reading.value, currency)}${reading.detail.all_in ? ' all in' : ''}.`];
  const under = reading.detail.below;
  if (under && under.listings > 0) {
    const tickets = under.count > 0 && under.count !== under.listings ? ` (${under.count} tickets)` : '';
    parts.push(
      `${under.listings} ${under.listings === 1 ? 'listing' : 'listings'} under ${money(below, currency)}${tickets}.`,
    );
  }
  if (watch.fired_value !== null) parts.push(`Down from ${money(watch.fired_value, currency)} last time.`);
  return {
    title: clip(`Under ${money(below, currency)}: ${watch.title}`, TITLE_MAX),
    body: clip(parts.join(' '), BODY_MAX),
    url: WATCH_URL,
    tag: `watch-${watch.id}`,
  };
}

export function failingPayload(watch: Pick<WatchRow, 'id' | 'title'>, error: string): PushPayload {
  return {
    title: clip(`Can't read: ${watch.title}`, TITLE_MAX),
    body: clip(`The last ${FAILURES_BEFORE_PUSH} checks failed. ${error} Still trying each hour.`, BODY_MAX),
    url: WATCH_URL,
    tag: `watch-${watch.id}-failing`,
  };
}

async function sendSafely(ports: WatchPorts, userId: string, payload: PushPayload): Promise<boolean> {
  try {
    return await ports.push(userId, payload);
  } catch {
    // The reading and the fired value are stored; the home page shows them.
    return false;
  }
}

export async function checkWatch(
  ports: WatchPorts,
  watch: WatchRow,
  now: Date,
): Promise<{ outcome: WatchOutcome; pushed: boolean }> {
  if (Date.parse(watch.ends_at) <= now.getTime()) {
    await ports.end(watch, now);
    return { outcome: 'ended', pushed: false };
  }
  if (watch.reading !== 'lowest_price') return { outcome: 'skipped', pushed: false };

  const reading = await ports.read(watch);
  await ports.saveReading({
    watch_id: watch.id,
    user_id: watch.user_id,
    taken_at: now.toISOString(),
    value: reading.ok ? reading.value : null,
    detail: reading.ok ? { ...reading.detail } : {},
    error: reading.ok ? null : reading.error,
  });

  if (!reading.ok) {
    const streak = failureStreak(await ports.recent(watch, FAILURES_BEFORE_PUSH + 1));
    if (streak !== FAILURES_BEFORE_PUSH) return { outcome: 'failed', pushed: false };
    return { outcome: 'failing', pushed: await sendSafely(ports, watch.user_id, failingPayload(watch, reading.error)) };
  }

  if (!shouldFire(watch, reading.value)) return { outcome: 'read', pushed: false };
  await ports.fired(watch, reading.value, now);
  return { outcome: 'fired', pushed: await sendSafely(ports, watch.user_id, firedPayload(watch, reading)) };
}

export async function runWatches(ports: WatchPorts, now: Date): Promise<WatchesSummary> {
  const watches = await ports.running();
  const summary: WatchesSummary = {
    watches: watches.length,
    outcomes: { ended: 0, read: 0, fired: 0, failed: 0, failing: 0, skipped: 0 },
    pushes: 0,
    errors: [],
  };

  let next = 0;
  async function worker() {
    while (next < watches.length) {
      const watch = watches[next++];
      try {
        const { outcome, pushed } = await checkWatch(ports, watch, now);
        summary.outcomes[outcome] += 1;
        if (pushed) summary.pushes += 1;
      } catch (err) {
        // One watch's failed write does not stop the others.
        summary.errors.push(`${watch.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, watches.length) }, worker));
  return summary;
}
