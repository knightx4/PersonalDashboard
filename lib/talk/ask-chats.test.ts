import { describe, expect, it } from 'vitest';
import { chatChips, chatGroup, chatWorkspaces, dayIn, groupChats, type AskChat } from './ask-chats';

const chat = (over: Partial<AskChat>): AskChat => ({
  id: 'c',
  ref: 'r',
  title: 'A chat',
  lastAt: '2026-10-14T09:00:00Z',
  day: '2026-10-14',
  workspaces: [],
  ...over,
});

describe('chatWorkspaces', () => {
  it('reads the workspaces of cited rows and of rows a lookup gave back, in the switcher order', () => {
    expect(
      chatWorkspaces([
        { citations: [{ table: 'todo.tasks', ref: 't', title: 'T', href: '/todo/all' }] },
        {
          toolCalls: [
            {
              name: 'job_applications',
              input: {},
              result: { ok: true, rows: [{ ref: 'a', href: '/jobs/roles/1', table: 'job_search.applications', title: 'A' }] },
            },
            { name: 'search', input: {}, result: { ok: true, rows: [] } },
            { name: 'add_idea', input: {}, result: { ok: false, error: 'no' } },
          ],
        },
        { citations: [{ table: 'shopping.orders', ref: 'o', title: 'O', href: '/shopping/orders/o' }] },
      ]),
    ).toEqual(['shopping', 'jobs', 'todo']);
  });

  it('leaves out addresses outside every workspace', () => {
    expect(chatWorkspaces([{ citations: [{ table: 'docs.specs', ref: 's', title: 'S', href: '/account' }] }])).toEqual([]);
    expect(chatWorkspaces([{ citations: null, toolCalls: null }])).toEqual([]);
  });
});

describe('the day groups', () => {
  it('puts a day in Today, Yesterday, This week or Earlier', () => {
    expect(chatGroup('2026-10-14', '2026-10-14')).toBe('Today');
    expect(chatGroup('2026-10-13', '2026-10-14')).toBe('Yesterday');
    expect(chatGroup('2026-10-08', '2026-10-14')).toBe('This week');
    expect(chatGroup('2026-10-07', '2026-10-14')).toBe('Earlier');
  });

  it('reads the day in the person\'s timezone', () => {
    expect(dayIn('2026-10-14T03:00:00Z', 'America/New_York')).toBe('2026-10-13');
    expect(dayIn('2026-10-14T03:00:00Z', 'Europe/London')).toBe('2026-10-14');
  });

  it('groups newest first and leaves out empty groups', () => {
    const groups = groupChats(
      [
        chat({ id: 'old', day: '2026-09-01', lastAt: '2026-09-01T09:00:00Z' }),
        chat({ id: 'a', lastAt: '2026-10-14T08:00:00Z' }),
        chat({ id: 'b', lastAt: '2026-10-14T10:00:00Z' }),
      ],
      '2026-10-14',
    );
    expect(groups.map((g) => [g.group, g.chats.map((c) => c.id)])).toEqual([
      ['Today', ['b', 'a']],
      ['Earlier', ['old']],
    ]);
  });
});

describe('chatChips', () => {
  it('lists each workspace any chat used once', () => {
    expect(chatChips([chat({ workspaces: ['todo', 'jobs'] }), chat({ workspaces: ['jobs'] })])).toEqual(['jobs', 'todo']);
  });
});
