import { describe, expect, it } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { countReadyCards, loadFeedPage } from './load';

/**
 * Now narrowed to one subject (plan #1698): every read of the cards carries
 * the subject, and the same calls without one read the whole deck.
 */

type Call = { table: string; method: string; args: unknown[] };

/** A client that answers every read with nothing and keeps each call made on it. */
function fakeClient(): { client: LearnSupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const result = { data: [], error: null, count: 0 };
    const target: Record<string, unknown> = {
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    };
    const proxy: object = new Proxy(target, {
      get(own, method: string) {
        if (method in own) return own[method];
        return (...args: unknown[]) => {
          calls.push({ table, method, args });
          return proxy;
        };
      },
    });
    return proxy;
  };
  const client = { from: (table: string) => builder(table) } as unknown as LearnSupabaseClient;
  return { client, calls };
}

function subjectFilters(calls: Call[]): unknown[][] {
  return calls
    .filter((call) => call.table === 'feed_cards' && call.method === 'eq' && call.args[0] === 'subject_id')
    .map((call) => call.args);
}

function cardReads(calls: Call[]): number {
  return calls.filter((call) => call.table === 'feed_cards' && call.method === 'select').length;
}

const SUBJECT = '00000000-0000-4000-8000-0000000000aa';

describe('loadFeedPage for one subject', () => {
  it('keeps every read of the cards to the subject', async () => {
    const { client, calls } = fakeClient();
    const cards = await loadFeedPage(client, [], { subjectId: SUBJECT });
    expect(cards).toEqual([]);
    // Coming back after "work on this", ready, then coming back after a skip.
    expect(cardReads(calls)).toBe(3);
    expect(subjectFilters(calls)).toEqual([
      ['subject_id', SUBJECT],
      ['subject_id', SUBJECT],
      ['subject_id', SUBJECT],
    ]);
  });

  it('reads the whole deck without one', async () => {
    const { client, calls } = fakeClient();
    await loadFeedPage(client, []);
    expect(cardReads(calls)).toBe(3);
    expect(subjectFilters(calls)).toEqual([]);
  });
});

describe('countReadyCards for one subject', () => {
  it('counts only the subject’s ready cards', async () => {
    const { client, calls } = fakeClient();
    await countReadyCards(client, SUBJECT);
    expect(subjectFilters(calls)).toEqual([['subject_id', SUBJECT]]);
  });

  it('counts every ready card without one', async () => {
    const { client, calls } = fakeClient();
    await countReadyCards(client);
    expect(subjectFilters(calls)).toEqual([]);
  });
});
