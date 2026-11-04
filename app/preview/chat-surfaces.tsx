import { AppShell } from '@/components/shell/app-shell';
import { tabsFor } from '@/lib/shell/tabs';
import { MENTOR_PALETTE, withChats, type PersonRow, type SearchHit, type ThreadMessage } from '@/lib/you/chat-threads-model';
import { NewMessage } from '@/app/chat/new-message';
import { PeopleView } from '@/app/chat/people-view';
import { PeopleSkeleton } from '@/app/chat/people-skeleton';
import { ThreadView } from '@/app/chat/people/[key]/thread-view';
import { ChatArrivalDemo, ChatTypingDemo } from './chat-moments';

/**
 * The Chat workspace in the gallery (plan #2748.1, #2748.6): People, its
 * first tab, as a messaging app: the list of everyone you talk to and an open
 * thread, in each of its states. The Dash tab is drawn by DashPageSurface in
 * ask-surfaces.tsx.
 */

/** Fixed, so the server's render and the browser's agree. */
const NOW = Date.parse('2026-11-03T09:00:00Z');
const ZONE = 'Europe/London';

function person(fields: Partial<PersonRow> & Pick<PersonRow, 'id' | 'key' | 'name' | 'colour'>): PersonRow {
  return {
    about: '',
    canTalk: true,
    chatId: `chat-${fields.id}`,
    last: null,
    unread: false,
    typingUntil: null,
    lastReadAt: null,
    ...fields,
  };
}

/** Six people: two unread, one typing, one never written to, a long name, and a guest not ready to talk. */
export const CHAT_PEOPLE: PersonRow[] = [
  person({
    id: 'm2',
    key: 'benjamin-franklin',
    name: 'Benjamin Franklin',
    colour: MENTOR_PALETTE[1],
    about: 'Habits',
    unread: true,
    last: { role: 'advisor', text: 'What is actually in the way?', at: '2026-11-03T07:12:00Z' },
  }),
  person({
    id: 'm1',
    key: 'cfo',
    name: 'The CFO',
    colour: MENTOR_PALETTE[7],
    about: 'Money',
    unread: true,
    last: {
      role: 'advisor',
      text: 'Your gym membership renewed at $260 this morning. You have checked in twice since August, so it is costing you $130 a visit.',
      at: '2026-11-02T18:40:00Z',
    },
  }),
  person({
    id: 'm3',
    key: 'mentor',
    name: 'The Mentor',
    colour: MENTOR_PALETTE[2],
    about: 'Career',
    last: { role: 'person', text: 'I keep replaying the review with Dana.', at: '2026-11-01T21:05:00Z' },
  }),
  person({
    id: 'm6',
    key: 'alexandrina',
    name: 'Dr Alexandrina Featherstonehaugh-Wetherby',
    colour: MENTOR_PALETTE[4],
    about: 'Health',
    last: { role: 'advisor', text: 'Then explain to me what you did get. Sloppy is fine.', at: '2026-10-30T12:00:00Z' },
  }),
  person({ id: 'm4', key: 'skeptic', name: 'The Skeptic', colour: MENTOR_PALETTE[5], about: 'Pushes back', chatId: null }),
  person({
    id: 'm5',
    key: 'richard-feynman',
    name: 'Richard Feynman',
    colour: MENTOR_PALETTE[3],
    about: 'Physics',
    canTalk: false,
    chatId: null,
  }),
];

const FRANKLIN = CHAT_PEOPLE[0];

function msg(id: string, role: 'person' | 'advisor', text: string, createdAt: string, extra: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    chatId: 'chat-m2',
    role,
    kind: 'reply',
    text,
    receipts: [],
    createdAt,
    deliveredAt: createdAt,
    readAt: createdAt,
    ...extra,
  };
}

/** A thread over three days: grouped replies, a text first with a receipt, and your last message read. */
const THREAD: ThreadMessage[] = [
  msg('t1', 'person', 'I keep going back and forth on whether to take the Northwind call', '2026-10-28T19:02:00Z'),
  msg('t2', 'advisor', 'Then take it. A call costs you an hour and commits you to nothing.', '2026-10-28T19:02:20Z', { kind: 'ack' }),
  msg(
    't3',
    'advisor',
    "Most men regret the doors they didn't knock on, not the ones that opened onto a dull room.",
    '2026-10-28T19:02:40Z',
  ),
  msg('t4', 'person', 'Fair. Booked it for Thursday.', '2026-10-28T19:10:00Z'),
  msg('t5', 'advisor', 'Good. Write down the one question you most want answered before you go in.', '2026-10-28T19:10:30Z'),
  msg(
    't6',
    'advisor',
    "Morning. You put the Northwind application off again yesterday. That's the third time this week.",
    '2026-11-03T07:11:00Z',
    { kind: 'text_first', receipts: [{ label: 'To do · Finish Northwind application', link: '/todo' }] },
  ),
  msg('t7', 'advisor', 'What is actually in the way?', '2026-11-03T07:12:00Z', { kind: 'text_first' }),
  msg('t8', 'person', 'Honestly, the cover letter. I do not know what to say about the gap last year.', '2026-11-03T08:58:00Z'),
];

const SEARCH: SearchHit[] = [
  {
    id: 's1',
    key: 'benjamin-franklin',
    name: 'Benjamin Franklin',
    colour: MENTOR_PALETTE[1],
    role: 'advisor',
    text: "Morning. You put the Northwind application off again yesterday. That's the third time this week.",
    at: '2026-11-03T07:11:00Z',
  },
  {
    id: 's2',
    key: 'benjamin-franklin',
    name: 'Benjamin Franklin',
    colour: MENTOR_PALETTE[1],
    role: 'person',
    text: 'I keep going back and forth on whether to take the Northwind call',
    at: '2026-10-28T19:02:00Z',
  },
];

function ChatShell({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <AppShell
      account="preview"
      module="chat"
      sections={tabsFor('chat', true)}
      displayName="Chris"
      email="chris@example.com"
      isOwner
      counts={{ jobs: '3', todo: '8', shopping: '1' }}
      theme={{ kind: 'written', id: 'paper' }}
      brief={null}
      pathname={path}
    >
      {children}
    </AppShell>
  );
}

/**
 * The Messages list's rows (plan #2879.2): only the chats there are, so the
 * Skeptic's is one just started from New message, nothing said yet, and
 * Richard Feynman, with no chat, is reached only through New message.
 */
export const MESSAGE_ROWS = withChats(CHAT_PEOPLE.map((r) => (r.key === 'skeptic' ? { ...r, chatId: 'chat-m4' } : r)));

/** Everyone New message offers: the people above, and one more with no chat yet. */
const EVERYONE: PersonRow[] = [
  ...CHAT_PEOPLE,
  {
    id: 'm7',
    key: 'seneca',
    name: 'Seneca',
    about: 'Calm',
    colour: MENTOR_PALETTE[6],
    canTalk: true,
    chatId: null,
    last: null,
    unread: false,
    typingUntil: null,
    lastReadAt: null,
  },
];

/** Messages with its chats, with none, not read, while loading, searched, or with New message open. */
export function ChatPeopleSurface({
  state = 'people',
}: {
  state?: 'people' | 'empty' | 'failed' | 'loading' | 'search' | 'nothing-found' | 'new';
}) {
  if (state === 'loading') {
    return (
      <ChatShell path="/chat">
        <PeopleSkeleton />
      </ChatShell>
    );
  }
  if (state === 'new') {
    return (
      <ChatShell path="/chat">
        <PeopleView rows={MESSAGE_ROWS} timezone={ZONE} now={NOW} live={false} adding>
          <NewMessage everyone={EVERYONE} />
        </PeopleView>
      </ChatShell>
    );
  }
  return (
    <ChatShell path="/chat">
      <PeopleView
        rows={
          state === 'empty' || state === 'failed'
            ? []
            : state === 'people'
              ? // The Mentor writing back, so the list draws "typing…" in a row (a hidden part of plan #2748.6).
                MESSAGE_ROWS.map((r) => (r.key === 'mentor' ? { ...r, typingUntil: '2026-11-03T09:00:20Z' } : r))
              : MESSAGE_ROWS
        }
        failed={state === 'failed'}
        query={state === 'search' ? 'Northwind' : state === 'nothing-found' ? 'sabbatical' : null}
        hits={state === 'search' ? SEARCH : state === 'nothing-found' ? [] : null}
        current={FRANKLIN.key}
        newest
        timezone={ZONE}
        now={NOW}
        live={false}
      >
        {/* On a laptop the newest thread opens beside the list; a phone shows the list alone. */}
        <ThreadView person={FRANKLIN} chatId={FRANKLIN.chatId} page={{ messages: THREAD, hasOlder: false }} typingUntil={null} timezone={ZONE} now={NOW} live={false} />
      </PeopleView>
    </ChatShell>
  );
}

type ThreadState = 'thread' | 'typing' | 'older' | 'failed' | 'new' | 'not-ready' | 'loading';

/** One thread open beside the list, in each of its states. */
export function ChatThreadSurface({ state = 'thread' }: { state?: ThreadState }) {
  if (state === 'loading') {
    return (
      <ChatShell path="/chat/people/benjamin-franklin">
        <PeopleSkeleton thread />
      </ChatShell>
    );
  }
  const who = state === 'new' ? CHAT_PEOPLE[4] : state === 'not-ready' ? CHAT_PEOPLE[5] : FRANKLIN;
  const rows = MESSAGE_ROWS.map((r) =>
    state === 'typing' && r.id === FRANKLIN.id ? { ...r, unread: false, typingUntil: '2026-11-03T09:00:20Z' } : r.id === who.id ? { ...r, unread: false } : r,
  );
  const messages =
    state === 'new' || state === 'not-ready'
      ? []
      : state === 'typing'
        ? THREAD.map((m) => (m.id === 't8' ? { ...m, readAt: null } : m))
        : state === 'failed'
          ? THREAD.slice(0, 7)
          : state === 'older'
            ? // Read from the top, where the earlier page loads; the to do further down is clipped by the pane.
              THREAD.map((m) => ({ ...m, receipts: [] }))
            : THREAD;
  return (
    <ChatShell path={`/chat/people/${who.key}`}>
      <PeopleView rows={rows} current={who.key} timezone={ZONE} now={NOW} live={false}>
        <ThreadView
          person={who}
          chatId={who.chatId}
          page={{ messages, hasOlder: state === 'older' }}
          typingUntil={state === 'typing' ? '2026-11-03T09:00:20Z' : null}
          timezone={ZONE}
          now={NOW}
          live={false}
          loadingOlder={state === 'older'}
          pending={
            state === 'failed'
              ? [
                  {
                    id: 'p1',
                    text: 'Honestly, the cover letter. I do not know what to say about the gap last year.',
                    at: '2026-11-03T08:58:00Z',
                    failed: 'Not sent. Check your connection.',
                  },
                ]
              : []
          }
        />
      </PeopleView>
    </ChatShell>
  );
}

/**
 * Their typing, played (plan #2748.10): the dots rise in, give way to their
 * text, and rise in again while another is coming.
 */
export function ChatTypingMomentSurface() {
  const rows = MESSAGE_ROWS.map((r) => (r.id === FRANKLIN.id ? { ...r, unread: false } : r));
  return (
    <ChatShell path={`/chat/people/${FRANKLIN.key}`}>
      <ChatTypingDemo
        rows={rows}
        person={FRANKLIN}
        base={THREAD}
        reply={msg('t9', 'advisor', 'Then write the bad version first. Nobody reads it but you.', '2026-11-03T09:00:10Z')}
        typingUntil="2026-11-03T09:00:40Z"
        timezone={ZONE}
        now={NOW}
      />
    </ChatShell>
  );
}

/** A text that arrives first, played (plan #2748.10): a mentor lower in the list writes and their row rises to the top. */
export function ChatArrivalMomentSurface() {
  const mentor = CHAT_PEOPLE[2];
  const after = [
    {
      ...mentor,
      unread: true,
      last: { role: 'advisor' as const, text: 'You said you would call Dana by Friday. Have you picked a time?', at: '2026-11-03T08:59:00Z' },
    },
    ...MESSAGE_ROWS.filter((r) => r.id !== mentor.id),
  ];
  return (
    <ChatShell path="/chat">
      <ChatArrivalDemo
        before={MESSAGE_ROWS}
        after={after}
        timezone={ZONE}
        now={NOW}
        open={{
          key: FRANKLIN.key,
          thread: (
            <ThreadView person={FRANKLIN} chatId={FRANKLIN.chatId} page={{ messages: THREAD, hasOlder: false }} typingUntil={null} timezone={ZONE} now={NOW} live={false} />
          ),
        }}
      />
    </ChatShell>
  );
}
