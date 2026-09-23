import { describe, expect, it } from 'vitest';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { loadSavedHeadlines, removeSavedStory, saveStory } from './stories';

type Call = { table: string; op: string; args: unknown[] };

/**
 * A client that answers the issue and sender reads from `rows`, and records
 * every call so a test can check what was written and what was filtered on.
 */
function fakeClient(rows: { issue?: unknown; sender?: unknown; saved?: unknown[] }) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const chain = {
        select: (...args: unknown[]) => (calls.push({ table, op: 'select', args }), chain),
        delete: () => (calls.push({ table, op: 'delete', args: [] }), chain),
        eq: (...args: unknown[]) => (calls.push({ table, op: 'eq', args }), chain),
        maybeSingle: async () => ({
          data: table === 'issues' ? (rows.issue ?? null) : (rows.sender ?? null),
          error: null,
        }),
        upsert: async (...args: unknown[]) => {
          calls.push({ table, op: 'upsert', args });
          return { error: null };
        },
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: table === 'saved_stories' ? (rows.saved ?? []) : null, error: null }),
      };
      return chain;
    },
  } as unknown as NewsSupabaseClient;
  return { client, calls };
}

const ISSUE = {
  sender_id: 's1',
  received_at: '2026-09-23T07:14:00Z',
  stories: [
    { headline: 'Rates held', summary: 'The bank kept rates.' },
    {
      headline: ' Six hours of stale balances ',
      summary: 'A failover post-mortem.',
      text: '  First paragraph.\n\nSecond.  ',
      link: 'https://example.com/a',
      image: 'javascript:alert(1)',
      topic: 'Technology',
    },
  ],
};

describe('saveStory', () => {
  it('copies the story as the newsletter holds it, not as the form sent it', async () => {
    const { client, calls } = fakeClient({
      issue: ISSUE,
      sender: { name: 'Infra Weekly', email: 'x@y.com' },
    });
    const saved = await saveStory(client, {
      userId: 'u1',
      issueId: 'i1',
      headline: 'Six hours of stale balances',
    });
    expect(saved).toBe(true);
    const upsert = calls.find((call) => call.op === 'upsert');
    expect(upsert?.table).toBe('saved_stories');
    expect(upsert?.args).toEqual([
      {
        user_id: 'u1',
        issue_id: 'i1',
        headline: 'Six hours of stale balances',
        summary: 'A failover post-mortem.',
        text: 'First paragraph.\n\nSecond.',
        link: 'https://example.com/a',
        image: null,
        sender_name: 'Infra Weekly',
        received_at: '2026-09-23T07:14:00Z',
      },
      { onConflict: 'user_id,issue_id,headline', ignoreDuplicates: true },
    ]);
  });

  it('names the sender by its address when it gave no name', async () => {
    const { client, calls } = fakeClient({
      issue: ISSUE,
      sender: { name: null, email: 'news@infra.dev' },
    });
    await saveStory(client, { userId: 'u1', issueId: 'i1', headline: 'Rates held' });
    const row = calls.find((call) => call.op === 'upsert')?.args[0] as Record<string, unknown>;
    expect(row.sender_name).toBe('news@infra.dev');
    expect(row.text).toBeNull();
  });

  it('saves nothing for a headline the newsletter does not have', async () => {
    const { client, calls } = fakeClient({ issue: ISSUE, sender: { name: 'Infra Weekly' } });
    expect(await saveStory(client, { userId: 'u1', issueId: 'i1', headline: 'Not a story' })).toBe(
      false,
    );
    expect(calls.some((call) => call.op === 'upsert')).toBe(false);
  });

  it('saves nothing for a newsletter that is not there', async () => {
    const { client, calls } = fakeClient({});
    expect(await saveStory(client, { userId: 'u1', issueId: 'i1', headline: 'Rates held' })).toBe(
      false,
    );
    expect(calls.some((call) => call.op === 'upsert')).toBe(false);
  });
});

describe('removeSavedStory', () => {
  it('deletes by issue and headline', async () => {
    const { client, calls } = fakeClient({});
    await removeSavedStory(client, { issueId: 'i1', headline: ' Rates held ' });
    expect(calls.filter((call) => call.table === 'saved_stories')).toEqual([
      { table: 'saved_stories', op: 'delete', args: [] },
      { table: 'saved_stories', op: 'eq', args: ['issue_id', 'i1'] },
      { table: 'saved_stories', op: 'eq', args: ['headline', 'Rates held'] },
    ]);
  });
});

describe('loadSavedHeadlines', () => {
  it('returns the headlines saved from the newsletter', async () => {
    const { client, calls } = fakeClient({ saved: [{ headline: 'Rates held' }] });
    const saved = await loadSavedHeadlines(client, 'i1');
    expect([...saved]).toEqual(['Rates held']);
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'eq', args: ['issue_id', 'i1'] });
  });
});
