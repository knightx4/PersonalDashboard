/**
 * The Ask Dash sheet's chats (plan #2981): no suggested questions under the
 * box, Earlier questions as one button in the header, and a row of marks
 * with Dash first and then every Messages chat, groups included, newest
 * first, each unread one said so.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AskDashPanel, AskDashProvider, type AskSource } from '@/components/shell/ask-dash';
import { ChatRow } from '@/components/shell/ask-dash-chats';
import { entriesOf, pickId, pickOf } from '@/lib/you/pane-threads-model';
import type { PersonRow } from '@/lib/you/chat-threads-model';
import type { GroupRow } from '@/lib/you/group-chats-model';

vi.mock('next/navigation', () => ({
  usePathname: () => '/todo',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const never = () => new Promise<never>(() => {});
const SOURCE: AskSource = {
  ask: never,
  recent: never,
  open: never,
  poll: never,
  costs: never,
  label: never,
  confirm: never,
  decline: never,
  undo: never,
  save: never,
  rate: never,
  chats: { list: never, open: never },
};

function person(id: string, name: string, at: string | null, fields: Partial<PersonRow> = {}): PersonRow {
  return {
    id,
    key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    about: '',
    colour: '#336699',
    canTalk: true,
    chatId: `chat-${id}`,
    last: at ? { text: 'Hello', role: 'advisor', at } : null,
    unread: false,
    typingUntil: null,
    lastReadAt: null,
    ...fields,
  };
}

const GROUP: GroupRow = {
  kind: 'group',
  id: '00000000-0000-4000-8000-0000000000a1',
  name: 'Northwind offer',
  title: 'Northwind offer',
  members: [
    { id: 'm1', key: 'cfo', name: 'The CFO', colour: '#aa3300', typingUntil: null },
    { id: 'm2', key: 'mentor', name: 'The Mentor', colour: '#0033aa', typingUntil: null },
  ],
  // Your own message last still counts as the chat's newest.
  last: { text: 'Thanks', role: 'person', speaker: null, at: '2026-11-03T09:00:00Z' },
  unread: false,
};

const ROWS = [
  person('a', 'Benjamin Franklin', '2026-11-03T07:00:00Z', { unread: true }),
  person('b', 'The Skeptic', null),
  person('c', 'The CFO', '2026-11-03T08:00:00Z'),
];

describe('the order of the chats', () => {
  it('runs newest message first, groups among them, quiet chats last', () => {
    const names = entriesOf(ROWS, [GROUP]).map((e) => (e.kind === 'group' ? e.row.title : e.row.name));
    expect(names).toEqual(['Northwind offer', 'The CFO', 'Benjamin Franklin', 'The Skeptic']);
  });

  it('gives each chat one id for its highlight and its kept draft', () => {
    const ids = entriesOf(ROWS, [GROUP]).map((e) => pickId(pickOf(e)));
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(`group:${GROUP.id}`);
    expect(pickId({ kind: 'dash' })).toBe('dash');
  });
});

describe('the row of chats', () => {
  function row(selected: string, entries = entriesOf(ROWS, [GROUP])): string {
    return renderToStaticMarkup(<ChatRow entries={entries} selected={selected} onPick={() => {}} />);
  }

  it('puts Dash first, then each chat in order', () => {
    const labels = [...row('dash').matchAll(/aria-label="([^"]+)" aria-pressed/g)].map((m) => m[1]);
    expect(labels).toEqual(['Dash', 'Northwind offer', 'The CFO', 'Benjamin Franklin, unread', 'The Skeptic']);
  });

  it('marks an unread chat with a dot and lights the open one', () => {
    const html = row('person:the-cfo');
    expect(html.match(/data-chat-unread/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="The CFO" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Dash" aria-pressed="false"/);
  });

  it('shows Dash alone when there are no chats yet', () => {
    const labels = [...row('dash', []).matchAll(/aria-label="([^"]+)" aria-pressed/g)].map((m) => m[1]);
    expect(labels).toEqual(['Dash']);
  });
});

describe('the sheet', () => {
  const html = renderToStaticMarkup(
    <AskDashProvider source={SOURCE}>
      <AskDashPanel page="/todo" source={SOURCE} onClose={() => {}} />
    </AskDashProvider>,
  );

  it('opens on Dash, with the row above the thread', () => {
    expect(html).toContain('>Ask Dash</h2>');
    expect(html).toContain('aria-label="Chats"');
    expect(html).toMatch(/aria-label="Dash" aria-pressed="true"/);
  });

  it('has Earlier questions as one button in its header and no list of them', () => {
    expect(html).toContain('aria-label="Earlier questions"');
    expect(html).not.toContain('All of them');
    expect(html).not.toContain('id="ask-dash-earlier"');
  });

  it('suggests no questions under the box', () => {
    expect(html).not.toContain('Which applications have');
    expect(html).not.toContain('Try asking');
  });
});
