import { describe, expect, it } from 'vitest';
import {
  chatChips,
  chatGroup,
  chatQuery,
  chatTitleFrom,
  chatWorkspaces,
  chipsThatFit,
  containsPattern,
  dayIn,
  groupChats,
  matchSnippet,
  MAX_CHAT_TITLE,
  splitArchived,
  type AskChat,
} from './ask-chats';

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

describe('pinned and archived chats (plan #1899.6)', () => {
  it('puts pinned chats first, the one pinned last at the top, and out of their day', () => {
    const groups = groupChats(
      [
        chat({ id: 'a', lastAt: '2026-10-14T10:00:00Z' }),
        chat({ id: 'p1', day: '2026-09-01', lastAt: '2026-09-01T09:00:00Z', pinnedAt: '2026-10-10T09:00:00Z' }),
        chat({ id: 'p2', pinnedAt: '2026-10-12T09:00:00Z' }),
      ],
      '2026-10-14',
    );
    expect(groups.map((g) => [g.group, g.chats.map((c) => c.id)])).toEqual([
      ['Pinned', ['p2', 'p1']],
      ['Today', ['a']],
    ]);
  });

  it('splits archived chats from the list', () => {
    const { listed, archived } = splitArchived([chat({ id: 'a' }), chat({ id: 'b', archivedAt: '2026-10-14T09:00:00Z' })]);
    expect(listed.map((c) => c.id)).toEqual(['a']);
    expect(archived.map((c) => c.id)).toEqual(['b']);
  });

  it('cuts a new name to one line and refuses an empty one', () => {
    expect(chatTitleFrom('  Lisbon\n flights ')).toBe('Lisbon flights');
    expect(chatTitleFrom('   ')).toBeNull();
    expect(chatTitleFrom('x'.repeat(200))).toHaveLength(MAX_CHAT_TITLE);
  });
});

describe('searching the chats (plan #1899.6)', () => {
  it('searches from two characters', () => {
    expect(chatQuery(' a ')).toBeNull();
    expect(chatQuery(' Catan  lot ')).toBe('Catan lot');
  });

  it('takes the wildcards in what was typed literally', () => {
    expect(containsPattern('50%_off')).toBe('%50\\%\\_off%');
  });

  it('shows the words around the match, whole words at each end', () => {
    const body = 'You spent a lot this quarter. Two of them are still unsold, and your todo to list the Catan lot is five days overdue.';
    const snippet = matchSnippet(body, 'catan', 20);
    expect(snippet).toContain('Catan');
    expect(snippet?.startsWith('…')).toBe(true);
    expect(snippet?.endsWith('…')).toBe(true);
    expect(matchSnippet(body, 'Lisbon')).toBeNull();
    expect(matchSnippet('Catan', 'catan')).toBe('Catan');
  });
});

describe('chipsThatFit', () => {
  it('shows every chip when they all fit, without More', () => {
    expect(chipsThatFit([50, 50, 50], 162, 40, 6)).toBe(3);
  });

  it('shows the whole chips that fit beside More, and none cut', () => {
    expect(chipsThatFit([50, 50, 50], 152, 40, 6)).toBe(2);
    expect(chipsThatFit([50, 50, 50], 151, 40, 6)).toBe(1);
    expect(chipsThatFit([50, 50, 50], 100, 40, 6)).toBe(1);
    expect(chipsThatFit([120], 100, 40, 6)).toBe(0);
  });
});

describe('chatChips', () => {
  it('lists each workspace any chat used once', () => {
    expect(chatChips([chat({ workspaces: ['todo', 'jobs'] }), chat({ workspaces: ['jobs'] })])).toEqual(['jobs', 'todo']);
  });
});
