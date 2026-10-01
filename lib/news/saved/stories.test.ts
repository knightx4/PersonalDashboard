import { describe, expect, it } from 'vitest';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import {
  loadStoryOrigins,
  loadSavedHeadlines,
  resaveStoryById,
  loadSavedStories,
  removeSavedStory,
  removeSavedStoryById,
  saveStory,
} from './stories';

type Call = { table: string; op: string; args: unknown[] };

/**
 * A client that answers the issue and sender reads from `rows`, and records
 * every call so a test can check what was written and what was filtered on.
 */
function fakeClient(rows: {
  issue?: unknown;
  sender?: unknown;
  saved?: unknown[];
  /** The one saved row a lookup by issue and headline finds. */
  savedRow?: unknown;
  /** What news.unsave_story returns: the story's issue. */
  unsaved?: string | null;
}) {
  const calls: Call[] = [];
  const client = {
    rpc: async (...args: unknown[]) => {
      calls.push({ table: 'rpc', op: 'rpc', args });
      return { data: rows.unsaved ?? null, error: null };
    },
    from: (table: string) => {
      const chain = {
        select: (...args: unknown[]) => (calls.push({ table, op: 'select', args }), chain),
        delete: () => (calls.push({ table, op: 'delete', args: [] }), chain),
        update: (...args: unknown[]) => (calls.push({ table, op: 'update', args }), chain),
        eq: (...args: unknown[]) => (calls.push({ table, op: 'eq', args }), chain),
        is: (...args: unknown[]) => (calls.push({ table, op: 'is', args }), chain),
        in: (...args: unknown[]) => (calls.push({ table, op: 'in', args }), chain),
        not: (...args: unknown[]) => (calls.push({ table, op: 'not', args }), chain),
        order: (...args: unknown[]) => (calls.push({ table, op: 'order', args }), chain),
        limit: (...args: unknown[]) => (calls.push({ table, op: 'limit', args }), chain),
        maybeSingle: async () => ({
          data:
            table === 'issues'
              ? (rows.issue ?? null)
              : table === 'saved_stories'
                ? (rows.savedRow ?? null)
                : (rows.sender ?? null),
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

  it('puts a story unsaved while something pointed at it back on the list', async () => {
    const { client, calls } = fakeClient({ issue: ISSUE, sender: { name: 'Infra Weekly' } });
    await saveStory(client, { userId: 'u1', issueId: 'i1', headline: 'Rates held' });
    const update = calls.find((call) => call.op === 'update');
    expect(update?.table).toBe('saved_stories');
    expect((update?.args[0] as Record<string, unknown>).unsaved_at).toBeNull();
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'eq', args: ['headline', 'Rates held'] });
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'not', args: ['unsaved_at', 'is', null] });
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
  it('finds the row by issue and headline and unsaves it', async () => {
    const { client, calls } = fakeClient({ savedRow: { id: 'r1' } });
    await removeSavedStory(client, { issueId: 'i1', headline: ' Rates held ' });
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'eq', args: ['issue_id', 'i1'] });
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'eq', args: ['headline', 'Rates held'] });
    expect(calls).toContainEqual({
      table: 'rpc',
      op: 'rpc',
      args: ['unsave_story', { story_id: 'r1' }],
    });
    expect(calls.some((call) => call.op === 'delete')).toBe(false);
  });

  it('does nothing for a story that is not saved', async () => {
    const { client, calls } = fakeClient({});
    await removeSavedStory(client, { issueId: 'i1', headline: 'Rates held' });
    expect(calls.some((call) => call.op === 'rpc')).toBe(false);
  });
});

describe('loadSavedHeadlines', () => {
  it('returns the headlines saved from the newsletter', async () => {
    const { client, calls } = fakeClient({ saved: [{ headline: 'Rates held' }] });
    const saved = await loadSavedHeadlines(client, 'i1');
    expect([...saved]).toEqual(['Rates held']);
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'eq', args: ['issue_id', 'i1'] });
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'is', args: ['unsaved_at', null] });
  });
});

describe('loadSavedStories', () => {
  it('reads the list newest saved first and maps each row', async () => {
    const { client, calls } = fakeClient({
      saved: [
        {
          id: 'r1',
          issue_id: null,
          headline: 'Rates held',
          summary: 'The bank kept rates.',
          text: null,
          link: 'https://example.com/a',
          image: null,
          sender_name: 'Infra Weekly',
          received_at: '2026-09-23T07:14:00Z',
          saved_at: '2026-09-23T08:00:00Z',
        },
      ],
    });
    expect(await loadSavedStories(client)).toEqual([
      {
        id: 'r1',
        issueId: null,
        headline: 'Rates held',
        summary: 'The bank kept rates.',
        text: null,
        link: 'https://example.com/a',
        image: null,
        senderName: 'Infra Weekly',
        receivedAt: '2026-09-23T07:14:00Z',
        savedAt: '2026-09-23T08:00:00Z',
      },
    ]);
    expect(calls).toContainEqual({
      table: 'saved_stories',
      op: 'order',
      args: ['saved_at', { ascending: false }],
    });
    // A story unsaved while a reading or a task points at it stays off Saved.
    expect(calls).toContainEqual({ table: 'saved_stories', op: 'is', args: ['unsaved_at', null] });
  });
});

describe('removeSavedStoryById', () => {
  it('unsaves by row id and says which issue the story came from', async () => {
    const { client, calls } = fakeClient({ unsaved: 'i1' });
    expect(await removeSavedStoryById(client, 'r1')).toEqual({ issueId: 'i1' });
    expect(calls).toContainEqual({
      table: 'rpc',
      op: 'rpc',
      args: ['unsave_story', { story_id: 'r1' }],
    });
  });

  it('gives no issue when the row was not there', async () => {
    const { client } = fakeClient({ unsaved: null });
    expect(await removeSavedStoryById(client, 'r1')).toEqual({ issueId: null });
  });
});

describe('loadStoryOrigins (plan #1368)', () => {
  it('opens a saved story on Saved, an unsaved one in its newsletter, and a lost one nowhere', async () => {
    const { client, calls } = fakeClient({
      saved: [
        { id: 'a', issue_id: 'i1', sender_name: 'Letters From Work', headline: 'Trams', unsaved_at: null },
        { id: 'b', issue_id: 'i2', sender_name: 'Money Stuff', headline: 'Bonds', unsaved_at: '2026-10-01T09:00:00Z' },
        { id: 'c', issue_id: null, sender_name: 'Gone Weekly', headline: 'Lost', unsaved_at: '2026-10-01T09:00:00Z' },
      ],
    });

    const origins = await loadStoryOrigins(client, ['a', 'b', 'c', 'a']);

    expect(Object.fromEntries(origins)).toEqual({
      a: { senderName: 'Letters From Work', headline: 'Trams', href: '/news/saved#story-a' },
      b: { senderName: 'Money Stuff', headline: 'Bonds', href: '/news/i/i2' },
      c: { senderName: 'Gone Weekly', headline: 'Lost', href: null },
    });
    expect(calls.find((c) => c.op === 'in')?.args).toEqual(['id', ['a', 'b', 'c']]);
  });

  it('asks nothing when no reading came from News', async () => {
    const { client, calls } = fakeClient({});
    expect((await loadStoryOrigins(client, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('resaveStoryById (plan #1368)', () => {
  it('returns the saved row and clears unsaved_at on it only if it was set', async () => {
    const { client, calls } = fakeClient({
      savedRow: {
        id: 's1',
        issue_id: null,
        headline: 'Rates held',
        link: 'https://example.com/r',
        sender_name: 'Money Stuff',
      },
    });

    expect(await resaveStoryById(client, 's1')).toEqual({
      id: 's1',
      issueId: null,
      headline: 'Rates held',
      link: 'https://example.com/r',
      senderName: 'Money Stuff',
    });
    const update = calls.findIndex((c) => c.op === 'update');
    expect(calls[update].args[0]).toMatchObject({ unsaved_at: null });
    expect(calls.slice(update)).toContainEqual({
      table: 'saved_stories',
      op: 'not',
      args: ['unsaved_at', 'is', null],
    });
  });

  it('returns null for a row that is not there, and writes nothing', async () => {
    const { client, calls } = fakeClient({});
    expect(await resaveStoryById(client, 'missing')).toBeNull();
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });
});
