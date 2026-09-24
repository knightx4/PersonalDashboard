import { describe, expect, it } from 'vitest';

import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import { loadQuickRead, passStories, passStory } from './quick';

type Call = { table: string; method: string; args: unknown[] };

/**
 * A client whose every query resolves to what `answer` gives for its table and
 * the calls made on it so far, and which records every call.
 */
function fakeClient(answer: (table: string, calls: Call[]) => { data: unknown; error: null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const own: Call[] = [];
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'not', 'order', 'limit', 'in', 'eq', 'is', 'upsert', 'update']) {
        chain[method] = (...args: unknown[]) => {
          const call = { table, method, args };
          calls.push(call);
          own.push(call);
          return chain;
        };
      }
      chain.maybeSingle = async () => answer(table, own);
      chain.then = (resolve: (value: unknown) => unknown) => resolve(answer(table, own));
      return chain;
    },
  };
  return { client: client as unknown as NewsSupabaseClient, calls };
}

const ISSUE = {
  id: 'i1',
  sender_id: 's1',
  subject: 'Weekly',
  received_at: '2026-09-23T08:00:00Z',
  summary: 'Two stories.',
  stories: [
    { headline: 'One', summary: 'First.' },
    { headline: 'Two', summary: 'Second.' },
  ],
};

describe('loadQuickRead', () => {
  it('returns the summarised newsletters with the stories passed in them', async () => {
    const { client, calls } = fakeClient((table) =>
      table === 'issues'
        ? { data: [ISSUE], error: null }
        : { data: [{ issue_id: 'i1', story_index: 1 }], error: null },
    );
    const { issues, passes } = await loadQuickRead(client);
    expect(issues).toEqual([
      {
        id: 'i1',
        senderId: 's1',
        subject: 'Weekly',
        receivedAt: '2026-09-23T08:00:00Z',
        summary: 'Two stories.',
        stories: ISSUE.stories,
      },
    ]);
    expect(passes).toEqual([{ issueId: 'i1', storyIndex: 1 }]);
    expect(calls).toContainEqual({
      table: 'story_passes',
      method: 'in',
      args: ['issue_id', ['i1']],
    });
  });

  it('asks for no passes when nothing has been summarised', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    expect(await loadQuickRead(client)).toEqual({ issues: [], passes: [] });
    expect(calls.some((call) => call.table === 'story_passes')).toBe(false);
  });
});

describe('passStory', () => {
  it('records the pass under the session user and leaves an unfinished newsletter unread', async () => {
    const { client, calls } = fakeClient((table) =>
      table === 'issues'
        ? { data: ISSUE, error: null }
        : { data: [{ issue_id: 'i1', story_index: 0 }], error: null },
    );
    const result = await passStory(client, { userId: 'u1', issueId: 'i1', storyIndex: 0 });
    expect(result).toEqual({ finished: false });
    expect(calls).toContainEqual({
      table: 'story_passes',
      method: 'upsert',
      args: [
        { user_id: 'u1', issue_id: 'i1', story_index: 0 },
        { onConflict: 'issue_id,story_index', ignoreDuplicates: true },
      ],
    });
    expect(calls.some((call) => call.method === 'update')).toBe(false);
  });

  it('marks the newsletter read once its last story is passed', async () => {
    const { client, calls } = fakeClient((table) =>
      table === 'issues'
        ? { data: ISSUE, error: null }
        : {
            data: [
              { issue_id: 'i1', story_index: 0 },
              { issue_id: 'i1', story_index: 1 },
            ],
            error: null,
          },
    );
    const result = await passStory(client, { userId: 'u1', issueId: 'i1', storyIndex: 1 });
    expect(result).toEqual({ finished: true });
    const update = calls.find((call) => call.method === 'update');
    expect(update?.table).toBe('issues');
    expect(calls).toContainEqual({ table: 'issues', method: 'is', args: ['read_at', null] });
  });
});

describe('passStories', () => {
  it('records every story on the page in one upsert and checks each newsletter once', async () => {
    const { client, calls } = fakeClient((table) =>
      table === 'issues'
        ? { data: ISSUE, error: null }
        : {
            data: [
              { issue_id: 'i1', story_index: 0 },
              { issue_id: 'i1', story_index: 1 },
            ],
            error: null,
          },
    );
    const result = await passStories(client, {
      userId: 'u1',
      stories: [
        { issueId: 'i1', storyIndex: 0 },
        { issueId: 'i1', storyIndex: 1 },
      ],
    });
    expect(result).toEqual({ finished: true });
    const upserts = calls.filter((call) => call.method === 'upsert');
    expect(upserts).toEqual([
      {
        table: 'story_passes',
        method: 'upsert',
        args: [
          [
            { user_id: 'u1', issue_id: 'i1', story_index: 0 },
            { user_id: 'u1', issue_id: 'i1', story_index: 1 },
          ],
          { onConflict: 'issue_id,story_index', ignoreDuplicates: true },
        ],
      },
    ]);
    expect(
      calls.filter((call) => call.table === 'issues' && call.method === 'select'),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'update')).toHaveLength(1);
  });

  it('writes nothing for an empty page', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    expect(await passStories(client, { userId: 'u1', stories: [] })).toEqual({ finished: false });
    expect(calls).toEqual([]);
  });
});
