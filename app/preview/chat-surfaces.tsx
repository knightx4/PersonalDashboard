import { AppShell } from '@/components/shell/app-shell';
import { tabsFor } from '@/lib/shell/tabs';
import { MENTOR_PALETTE, withChats, type PersonRow, type SearchHit, type ThreadMessage } from '@/lib/you/chat-threads-model';
import { NewMessage } from '@/app/chat/new-message';
import { PeopleView } from '@/app/chat/people-view';
import { PeopleSkeleton } from '@/app/chat/people-skeleton';
import { ThreadView } from '@/app/chat/people/[key]/thread-view';
import { nextTextLine } from '@/lib/you/reach-out-card-model';
import type { DashChange } from '@/lib/talk/changes';
import type { BuildRun } from '@/lib/you/live-cards';
import { ChangeThreadDemo, ChatArrivalDemo, ChatTypingDemo } from './chat-moments';
import { GroupSettings } from '@/app/chat/groups/[id]/group-settings';
import { GroupThreadView } from '@/app/chat/groups/[id]/group-thread-view';
import { groupTitleOf, type GroupMember, type GroupRow, type Reacted } from '@/lib/you/group-chats-model';
import type { PaneChats } from '@/components/shell/ask-dash-chats';
import type { PaneThread } from '@/lib/you/pane-threads-model';
import { MARKETS_LINE, MARKETS_TABLE } from './chart-fixtures';

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
const STARTED = CHAT_PEOPLE.map((r) => (r.key === 'skeptic' ? { ...r, chatId: 'chat-m4' } : r));
export const MESSAGE_ROWS = withChats(STARTED);

/** Everyone New message offers: the people above, and one more with no chat yet. */
export const EVERYONE: PersonRow[] = [
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

// ---------------------------------------------------------------------------
// A group (plan #2879.1.3): Benjamin Franklin, the CFO and the Mentor.
// ---------------------------------------------------------------------------

const GROUP_ID = '00000000-0000-4000-8000-0000000000a1';

function member(row: PersonRow, typingUntil: string | null = null): GroupMember {
  return { id: row.id, key: row.key, name: row.name, colour: row.colour, typingUntil };
}

const GROUP_MEMBERS: GroupMember[] = [member(CHAT_PEOPLE[0]), member(CHAT_PEOPLE[1]), member(CHAT_PEOPLE[2])];

function gmsg(id: string, speaker: string | null, text: string, createdAt: string): ThreadMessage {
  return { ...msg(id, speaker ? 'advisor' : 'person', text, createdAt), chatId: GROUP_ID, speakerId: speaker };
}

/** A morning in the group: the person asks, two answer, one pushes back on the other, and the rest tap back. */
const GROUP_THREAD: ThreadMessage[] = [
  gmsg('g1', null, 'Northwind offered 12% more than I make now. Should I take it, or use it to ask for a raise here?', '2026-11-03T08:40:00Z'),
  gmsg('g2', 'm1', 'Twelve percent is about $14,000 a year before tax. That is real, but it is not life changing on its own.', '2026-11-03T08:40:20Z'),
  gmsg('g3', 'm1', 'What would the commute cost you?', '2026-11-03T08:40:30Z'),
  gmsg('g4', 'm3', 'Ask yourself which job you would want in three years. The money follows the work you get good at.', '2026-11-03T08:41:00Z'),
  gmsg('g5', 'm2', 'Mentor, that is too easy. A raise here costs nothing to ask for, and you learn what they think you are worth.', '2026-11-03T08:41:30Z'),
  gmsg('g6', null, 'The commute is the same. I think I want the work at Northwind more.', '2026-11-03T08:50:00Z'),
];

const GROUP_REACTIONS: Record<string, Reacted[]> = {
  g4: [{ advisorId: 'm2', reaction: 'thumbs_up' }],
  g5: [
    { advisorId: 'm1', reaction: 'emphasis' },
    { advisorId: 'm3', reaction: 'laugh' },
  ],
  g6: [{ advisorId: 'm1', reaction: 'heart' }],
};

export const GROUP_ROW: GroupRow = {
  kind: 'group',
  id: GROUP_ID,
  name: 'Northwind offer',
  title: 'Northwind offer',
  members: GROUP_MEMBERS,
  last: { role: 'advisor', speaker: 'The Mentor', text: 'Then that is your answer. Ask Northwind for the start date you want.', at: '2026-11-03T08:52:00Z' },
  unread: true,
};

/** A group with no name, called by its members' first names. */
const UNNAMED_GROUP: GroupRow = {
  kind: 'group',
  id: '00000000-0000-4000-8000-0000000000b2',
  name: null,
  title: groupTitleOf(null, [CHAT_PEOPLE[3].name, CHAT_PEOPLE[4].name]),
  members: [member(CHAT_PEOPLE[3]), member(CHAT_PEOPLE[4])],
  last: { role: 'person', speaker: null, text: 'Thanks, both of you.', at: '2026-10-29T10:00:00Z' },
  unread: false,
};

export const MESSAGE_GROUPS: GroupRow[] = [GROUP_ROW, UNNAMED_GROUP];

type GroupState = 'thread' | 'typing' | 'new' | 'reply-failed' | 'settings' | 'settings-delete';

/** A group open beside the list, in each of its states, and its settings. */
export function ChatGroupSurface({ state = 'thread' }: { state?: GroupState }) {
  const typing = state === 'typing';
  const members = typing
    ? GROUP_MEMBERS.map((m) => (m.id === 'm1' || m.id === 'm3' ? { ...m, typingUntil: '2026-11-03T09:00:20Z' } : m))
    : GROUP_MEMBERS;
  // A group just started has no name of its own, so the list and the thread both call it by its members.
  const unnamed = groupTitleOf(null, GROUP_MEMBERS.map((m) => m.name));
  const groups = MESSAGE_GROUPS.map((g) =>
    g.id === GROUP_ID
      ? {
          ...g,
          unread: false,
          members,
          ...(state === 'new' ? { last: null, name: null, title: unnamed } : {}),
          ...(state === 'reply-failed' ? { last: { role: 'person' as const, speaker: null, text: GROUP_THREAD[GROUP_THREAD.length - 1].text, at: '2026-11-03T08:50:00Z' } } : {}),
        }
      : g,
  );
  // A burst that failed leaves your last text with no answer (plan #2988.3).
  const messages = state === 'new' ? [] : typing || state === 'reply-failed' ? GROUP_THREAD : [...GROUP_THREAD, gmsg('g7', 'm3', 'Then that is your answer. Ask Northwind for the start date you want.', '2026-11-03T08:52:00Z')];
  return (
    <ChatShell path={`/chat/groups/${GROUP_ID}`}>
      <PeopleView rows={MESSAGE_ROWS} groups={groups} current={GROUP_ID} timezone={ZONE} now={NOW} live={false}>
        {state === 'settings' || state === 'settings-delete' ? (
          <GroupSettings chatId={GROUP_ID} name="Northwind offer" members={GROUP_MEMBERS} everyone={EVERYONE} confirming={state === 'settings-delete'} />
        ) : (
          <GroupThreadView
            chatId={GROUP_ID}
            title={state === 'new' ? unnamed : 'Northwind offer'}
            members={members}
            former={[]}
            replyFailed={state === 'reply-failed' ? 'The group ran out of time before anyone answered.' : null}
            page={{ messages, hasOlder: false, reactions: state === 'reply-failed' ? { g4: GROUP_REACTIONS.g4, g5: GROUP_REACTIONS.g5 } : GROUP_REACTIONS }}
            timezone={ZONE}
            now={NOW}
            live={false}
          />
        )}
      </PeopleView>
    </ChatShell>
  );
}

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
        <PeopleView rows={MESSAGE_ROWS} groups={MESSAGE_GROUPS} timezone={ZONE} now={NOW} live={false} adding>
          {/* Three picked, so the To line holds them and the group's name can be given (plan #2879.1.3). */}
          <NewMessage everyone={EVERYONE} picked={['benjamin-franklin', 'cfo', 'mentor']} />
        </PeopleView>
      </ChatShell>
    );
  }
  return (
    <ChatShell path="/chat">
      <PeopleView
        groups={state === 'people' || state === 'search' || state === 'nothing-found' ? MESSAGE_GROUPS : []}
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

type ThreadState =
  | 'thread'
  | 'typing'
  | 'older'
  | 'failed'
  | 'reply-failed'
  | 'new'
  | 'not-ready'
  | 'loading'
  | 'next-text'
  | 'files'
  | 'charts'
  | 'adding';

/** A screenshot of the offer and its letter, sent to Franklin (plan #2974). */
const OFFER_FILES = [
  { id: 'f1', name: 'Pasted image 1.png', contentType: 'image/png', size: 184_320, href: '/gallery/offer-screenshot.svg' },
  { id: 'f2', name: 'Northwind offer letter, signed copy.pdf', contentType: 'application/pdf', size: 1_258_291, href: '#' },
];

/** The thread once the offer went with a question, and Franklin's reply that read it. */
const FILES_THREAD: ThreadMessage[] = [
  ...THREAD.slice(0, 7),
  msg('t8', 'person', 'They sent the offer. Is the equity any good?', '2026-11-03T08:58:00Z', {
    files: OFFER_FILES,
    deliveredAt: '2026-11-03T08:58:01Z',
    readAt: '2026-11-03T08:58:02Z',
  }),
  msg('t9', 'advisor', 'Four thousand units over four years is a thousand a year. The letter does not say what a unit is worth.', '2026-11-03T08:58:30Z'),
  msg('t10', 'advisor', 'Ask them for the last valuation before the 14th. The $132,000 base is the part to weigh.', '2026-11-03T08:58:40Z'),
  msg('t11', 'person', 'Pasted image 2.png', '2026-11-03T08:59:00Z', {
    files: [{ id: 'f3', name: 'Pasted image 2.png', contentType: 'image/png', size: 96_256, href: '/gallery/offer-screenshot.svg' }],
  }),
];

/**
 * Asking for a chart of the markets (plan #3050.2.2): two texts back, and
 * under the second the line chart with each index and the table of closes,
 * kept on that message's charts.
 */
const CHARTS_THREAD: ThreadMessage[] = [
  ...THREAD.slice(0, 7),
  msg('t8', 'person', 'Can you show me a chart of the stock markets past week?', '2026-11-03T08:58:00Z', {
    deliveredAt: '2026-11-03T08:58:01Z',
    readAt: '2026-11-03T08:58:02Z',
  }),
  msg('t9', 'advisor', 'All three ended the week up, after a dip on Wednesday.', '2026-11-03T08:58:30Z'),
  msg('t10', 'advisor', 'The Nasdaq gained most, 1.71% since Monday. The chart has each day.', '2026-11-03T08:58:40Z', {
    charts: [MARKETS_LINE, MARKETS_TABLE],
  }),
];

/** Two files in the box waiting to go, and one the box refused. */
const ADDING_FILES = [
  { path: 'u/00000000-0000-4000-8000-000000000001-Pasted-image-1.png', name: 'Pasted image 1.png', contentType: 'image/png' as const, size: 184_320 },
  {
    path: 'u/00000000-0000-4000-8000-000000000002-offer.pdf',
    name: 'Northwind offer letter, signed copy.pdf',
    contentType: 'application/pdf' as const,
    size: 1_258_291,
  },
];
const ADDING_ERRORS = ['Portfolio.zip cannot be added. Use an image, a PDF, a Word file, text or CSV.'];

/** Franklin's rule texts next on Monday (plan #2931.3), as the thread's header says it. */
const NEXT_TEXT = nextTextLine({ at: '2026-11-09T09:00:00Z' }, { timeZone: ZONE, now: NOW });

/** Their reply that could not be written (plan #2854.4), as the thread says it. */
const REPLY_FAILED_WHY = 'Benjamin Franklin could not reply: the answer was cut off. Nothing was lost.';
/** A change someone on People made or proposed in Franklin's thread, under the text that asked. */
function threadChange(fields: Pick<DashChange, 'id' | 'kind' | 'input' | 'status' | 'advisorMessageId'> & Partial<DashChange>): DashChange {
  return {
    conversationId: '',
    turnId: null,
    subjectRef: null,
    writtenTable: null,
    writtenRef: null,
    undo: null,
    createdAt: '2026-11-03T08:58:30Z',
    doneAt: null,
    declinedAt: null,
    undoneAt: null,
    advisorId: FRANKLIN.id,
    advisorChatId: 'chat-m2',
    ...fields,
  } as DashChange;
}

/** You ask Franklin for a todo, then for a build and a clean-up: one made with Undo, two waiting on Confirm. */
const ACTED: ThreadMessage[] = [
  ...THREAD.slice(0, 5),
  msg('c1', 'person', 'Add a todo to finish the Northwind cover letter by Friday', '2026-11-03T08:40:00Z'),
  msg('c2', 'advisor', 'Done. Friday it is, and no polishing past the second draft.', '2026-11-03T08:40:20Z'),
  msg('c3', 'person', 'Also start the build of the live card step, and clear out the old duplicate answers on Jobs', '2026-11-03T08:52:00Z'),
  msg('c4', 'advisor', 'Both are below. Nothing happens to either until you press Confirm.', '2026-11-03T08:52:30Z'),
];

const ACTED_CHANGES: DashChange[] = [
  threadChange({
    id: 'x-todo',
    kind: 'add_todo',
    input: { title: 'Finish the Northwind cover letter', body: null, dueOn: '2026-11-06', dueTime: null, pinned: false },
    status: 'done',
    subjectRef: 'todo.tasks:x-todo-row',
    writtenTable: 'todo.tasks',
    writtenRef: 'x-todo-row',
    doneAt: '2026-11-03T08:40:10Z',
    advisorMessageId: 'c1',
  }),
  threadChange({
    id: 'x-build',
    kind: 'start_build',
    input: { stepId: 'x-step', number: 2860, outline: '2854.3', title: 'Show a small live card while a person works', quiet: false },
    status: 'proposed',
    advisorMessageId: 'c3',
  }),
  threadChange({
    id: 'x-delete',
    kind: 'delete_rows',
    input: {
      table: 'job_search.application_answers',
      count: 2,
      titles: ['Why do you want to work here? (copy)', 'Tell us about a hard problem (copy)'],
      href: '/jobs/answers',
      rows: [],
    },
    status: 'proposed',
    advisorMessageId: 'c3',
  }),
];

/** A thread where they acted when asked (plan #2854.2.1): a todo made with Undo, a build and a delete waiting on Confirm. */
export function ChatThreadChangesSurface() {
  const rows = CHAT_PEOPLE.map((r) => (r.id === FRANKLIN.id ? { ...r, unread: false } : r));
  return (
    <ChatShell path={`/chat/people/${FRANKLIN.key}`}>
      <PeopleView rows={rows} current={FRANKLIN.key} timezone={ZONE} now={NOW} live={false}>
        <ChangeThreadDemo
          person={FRANKLIN}
          chatId={FRANKLIN.chatId}
          page={{ messages: ACTED, hasOlder: false }}
          typingUntil={null}
          timezone={ZONE}
          now={NOW}
          live={false}
          changes={ACTED_CHANGES}
          today="2026-11-03"
        />
      </PeopleView>
    </ChatShell>
  );
}

/** You ask Franklin to text about two things no fixed watch reads: one watch approved last week, one waiting on you. */
const WATCHED: ThreadMessage[] = [
  ...THREAD.slice(3, 5),
  msg('v1', 'person', 'Tell me whenever a new role at Northwind is posted', '2026-10-27T09:10:00Z'),
  msg('v2', 'advisor', 'I wrote a watch for it. Approve it and I will text you when one appears.', '2026-10-27T09:10:30Z'),
  msg('v3', 'person', 'And text me when a note in my vault mentions my sister Ruth, so I remember to call her back', '2026-11-03T08:52:00Z'),
  msg('v4', 'advisor', 'Below is what I would check and what a text would say. Nothing runs until you approve it.', '2026-11-03T08:52:30Z'),
];

function watchChange(id: string, messageId: string, watch: NonNullable<DashChange['watch']>): DashChange {
  return threadChange({
    id,
    kind: 'set_reach_out',
    input: { verb: 'Wrote a watch for', what: FRANKLIN.name, rest: '', href: `/chat/people/${FRANKLIN.key}`, where: `Open ${FRANKLIN.name}`, paths: [] },
    status: 'done',
    subjectRef: `you.advisor_watches:${watch.id}`,
    writtenTable: 'you.advisor_watches',
    writtenRef: watch.id,
    doneAt: '2026-11-03T08:52:20Z',
    advisorMessageId: messageId,
    watch,
  });
}

const WATCHED_CHANGES: DashChange[] = [
  watchChange('v-roles', 'v1', {
    id: 'w-roles',
    about: 'New roles posted at Northwind',
    sendsWhen: 'A role at Northwind appears on Jobs that was not there at the last check.',
    sample: 'Northwind just posted a Senior Product Manager role. It is on Jobs now.',
    everyDays: 1,
    mode: 'each',
    tables: ['job_search.roles'],
    status: 'active',
    matched: 2,
  }),
  watchChange('v-ruth', 'v3', {
    id: 'w-ruth',
    about: 'Vault notes that mention your sister Ruth',
    sendsWhen: 'A note in your vault that names Ruth is new or changed since the last check.',
    sample: 'Your note from Tuesday mentions Ruth and a call you meant to return. Worth ringing her this week?',
    everyDays: 1,
    mode: 'roundup',
    tables: ['obsidian.notes'],
    status: 'proposed',
    matched: 0,
  }),
];

/** Watches Dash wrote in a thread (plan #3030.1.2): one approved, one waiting with Approve and Decline. */
export function ChatThreadWatchSurface() {
  const rows = CHAT_PEOPLE.map((r) => (r.id === FRANKLIN.id ? { ...r, unread: false } : r));
  return (
    <ChatShell path={`/chat/people/${FRANKLIN.key}`}>
      <PeopleView rows={rows} current={FRANKLIN.key} timezone={ZONE} now={NOW} live={false}>
        <ChangeThreadDemo
          person={FRANKLIN}
          chatId={FRANKLIN.chatId}
          page={{ messages: WATCHED, hasOlder: false }}
          typingUntil={null}
          timezone={ZONE}
          now={NOW}
          live={false}
          changes={WATCHED_CHANGES}
          today="2026-11-03"
        />
      </PeopleView>
    </ChatShell>
  );
}

/** You ask Franklin for two things and he is still on it: the todo is made, the reply is not in yet. */
const WORKING: ThreadMessage[] = [
  ...THREAD.slice(3, 7),
  msg('w1', 'person', 'Add a todo to finish the Northwind cover letter by Friday, and a step under the job search goal to ask Dana for a reference', '2026-11-03T08:59:40Z'),
];

const WORKING_CHANGES: DashChange[] = [
  threadChange({
    id: 'w-todo',
    kind: 'add_todo',
    input: { title: 'Finish the Northwind cover letter', body: null, dueOn: '2026-11-06', dueTime: null, pinned: false },
    status: 'done',
    subjectRef: 'todo.tasks:w-todo-row',
    writtenTable: 'todo.tasks',
    writtenRef: 'w-todo-row',
    doneAt: '2026-11-03T08:59:50Z',
    advisorMessageId: 'w1',
  }),
  threadChange({
    id: 'w-step',
    kind: 'add_goal_step',
    input: { parentId: 'g-jobs', goalTitle: 'Land a product role by spring', title: 'Ask Dana for a reference', kind: 'mine' },
    status: 'done',
    subjectRef: 'goals.items:w-step-row',
    writtenTable: 'goals.items',
    writtenRef: 'w-step-row',
    doneAt: '2026-11-03T08:59:55Z',
    advisorMessageId: 'w1',
  }),
];

/**
 * The live card while they work (plan #2854.3): you asked for two things,
 * both are made, and the reply is still being written, so the card at the
 * foot says the newest and that one came before it.
 */
export function ChatThreadWorkingSurface() {
  const rows = CHAT_PEOPLE.map((r) => (r.id === FRANKLIN.id ? { ...r, unread: false, typingUntil: '2026-11-03T09:00:20Z' } : r));
  return (
    <ChatShell path={`/chat/people/${FRANKLIN.key}`}>
      <PeopleView rows={rows} current={FRANKLIN.key} timezone={ZONE} now={NOW} live={false}>
        <ChangeThreadDemo
          person={FRANKLIN}
          chatId={FRANKLIN.chatId}
          page={{ messages: WORKING, hasOlder: false }}
          typingUntil="2026-11-03T09:00:20Z"
          timezone={ZONE}
          now={NOW}
          live={false}
          changes={WORKING_CHANGES}
          today="2026-11-03"
        />
      </PeopleView>
    </ChatShell>
  );
}

/** Three builds you confirmed in the thread: one built, one waiting on your answer, one going. */
const BUILT: ThreadMessage[] = [
  ...THREAD.slice(3, 5),
  msg('b1', 'person', 'Start the build of the texting step', '2026-11-03T07:30:00Z'),
  msg('b2', 'advisor', 'Confirm it below and it goes.', '2026-11-03T07:30:20Z'),
  msg('b3', 'person', 'And the export step, then the live card one', '2026-11-03T08:20:00Z'),
  msg('b4', 'advisor', 'Both are below. The live card one is the bigger of the two.', '2026-11-03T08:20:30Z'),
];

function startedBuild(id: string, runId: string, messageId: string, number: number, outline: string, title: string): DashChange {
  return threadChange({
    id,
    kind: 'start_build',
    input: { stepId: `step-${id}`, number, outline, title, quiet: false },
    status: 'done',
    subjectRef: `public.plan_runs:${runId}`,
    writtenTable: 'public.plan_runs',
    writtenRef: runId,
    doneAt: '2026-11-03T08:21:00Z',
    advisorMessageId: messageId,
  });
}

const BUILD_CHANGES: DashChange[] = [
  startedBuild('b-text', 'run-text', 'b1', 2855, '2854.1', 'Make People feel like texting'),
  startedBuild('b-export', 'run-export', 'b3', 2861, '2861.2', 'Export the plan as a file'),
  startedBuild('b-live', 'run-live', 'b3', 2860, '2854.3', 'Show a small live card while a person works'),
];

const BUILD_RUNS: Record<string, BuildRun> = {
  'run-text': { runId: 'run-text', status: 'finished', stepStatus: 'done', stopReason: null, error: null, progress: { state: 'done', action: 'Finished #2854.1', needs: null } },
  'run-export': {
    runId: 'run-export',
    status: 'awaiting_input',
    stepStatus: 'in_progress',
    stopReason: null,
    error: null,
    progress: { state: 'waiting', action: 'Asked which format', needs: 'Should the export be one CSV file, or JSON that keeps the nesting?' },
  },
  'run-live': {
    runId: 'run-live',
    status: 'started',
    stepStatus: 'in_progress',
    stopReason: null,
    error: null,
    progress: { state: 'working', action: 'Running the checks: 2 of 5 passed', needs: null },
  },
};

/**
 * Builds followed from the thread (plan #2854.3): each confirmed build's row
 * says where it stands from its run, built, waiting on your answer or going,
 * with the link to its step.
 */
export function ChatThreadBuildsSurface() {
  const rows = CHAT_PEOPLE.map((r) => (r.id === FRANKLIN.id ? { ...r, unread: false } : r));
  return (
    <ChatShell path={`/chat/people/${FRANKLIN.key}`}>
      <PeopleView rows={rows} current={FRANKLIN.key} timezone={ZONE} now={NOW} live={false}>
        <ChangeThreadDemo
          person={FRANKLIN}
          chatId={FRANKLIN.chatId}
          page={{ messages: BUILT, hasOlder: false }}
          typingUntil={null}
          timezone={ZONE}
          now={NOW}
          live={false}
          changes={BUILD_CHANGES}
          builds={BUILD_RUNS}
          today="2026-11-03"
        />
      </PeopleView>
    </ChatShell>
  );
}

/** One thread open beside the list, in each of its states. */
export function ChatThreadSurface({ state = 'thread' }: { state?: ThreadState }) {
  if (state === 'loading') {
    return (
      <ChatShell path="/chat/people/benjamin-franklin">
        <PeopleSkeleton thread />
      </ChatShell>
    );
  }
  const who =
    state === 'new'
      ? CHAT_PEOPLE[4]
      : state === 'not-ready'
        ? CHAT_PEOPLE[5]
        : state === 'reply-failed'
          ? { ...FRANKLIN, replyFailed: REPLY_FAILED_WHY }
          : FRANKLIN;
  // The open thread keeps its row, as the page draws it, even for someone with no chat yet.
  const rows = withChats(STARTED, who.key).map((r) =>
    state === 'typing' && r.id === FRANKLIN.id ? { ...r, unread: false, typingUntil: '2026-11-03T09:00:20Z' } : r.id === who.id ? { ...r, unread: false } : r,
  );
  const messages =
    state === 'new' || state === 'not-ready'
      ? []
      : state === 'typing'
        ? THREAD.map((m) => (m.id === 't8' ? { ...m, readAt: null } : m))
        : state === 'failed' || state === 'adding'
          ? THREAD.slice(0, 7)
          : state === 'files'
            ? FILES_THREAD
            : state === 'charts'
            ? CHARTS_THREAD
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
          nextText={state === 'next-text' ? NEXT_TEXT : null}
          draftFiles={state === 'adding' ? ADDING_FILES : undefined}
          draftFileErrors={state === 'adding' ? ADDING_ERRORS : undefined}
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

/** The builder on People (plan #2854.1): the person who texts first about the plan. */
export const BUILDER_ROW: PersonRow = person({
  id: 'm7',
  key: 'builder',
  name: 'Builder',
  colour: MENTOR_PALETTE[6],
  about: 'Dev',
  chatId: 'chat-m7',
});

const builderMsg = (id: string, role: 'person' | 'advisor', text: string, at: string, extra: Partial<ThreadMessage> = {}) =>
  msg(id, role, text, at, { chatId: 'chat-m7', ...extra });

/** Yesterday's exchange, then the morning's first text: one batch of three short bubbles, not yet read. */
const BUILDER_THREAD: ThreadMessage[] = [
  builderMsg('b1', 'person', 'Anything I need to look at before tomorrow?', '2026-11-02T17:40:00Z'),
  builderMsg('b2', 'advisor', 'No. Two builds are running and neither needs you yet.', '2026-11-02T17:40:20Z'),
  builderMsg('b3', 'advisor', '#2854.6 is a question for you: Which card should a long build show in the thread?', '2026-11-03T08:05:00.000Z', {
    kind: 'text_first',
    readAt: null,
  }),
  builderMsg(
    'b4',
    'advisor',
    'Shipped 3: #2854.2 (Give every person on People the same…), #2854.2.1 (Show each change a person on People…) and #2854.4 (Replies keep going when I leave the page).',
    '2026-11-03T08:05:00.001Z',
    { kind: 'text_first', readAt: null },
  ),
  builderMsg('b5', 'advisor', 'The build of #2815.4 stalled.', '2026-11-03T08:05:00.002Z', { kind: 'text_first', readAt: null }),
];

/** The builder's thread open on the morning's first text, its row at the top of the list. */
export function ChatBuilderTextSurface() {
  const rows: PersonRow[] = [
    { ...BUILDER_ROW, last: { role: 'advisor', text: 'The build of #2815.4 stalled.', at: '2026-11-03T08:05:00Z' } },
    ...CHAT_PEOPLE,
  ];
  return (
    <ChatShell path={`/chat/people/${BUILDER_ROW.key}`}>
      <PeopleView rows={rows} current={BUILDER_ROW.key} timezone={ZONE} now={NOW} live={false}>
        <ThreadView
          person={BUILDER_ROW}
          chatId={BUILDER_ROW.chatId}
          page={{ messages: BUILDER_THREAD, hasOlder: false }}
          typingUntil={null}
          timezone={ZONE}
          now={NOW}
          live={false}
        />
      </PeopleView>
    </ChatShell>
  );
}

/**
 * The Ask Dash sheet's chats (plan #2981): the Messages rows and groups for
 * its row, and each thread as it opens in the sheet, from the fixtures above.
 */
export const PANE_CHATS: PaneChats = {
  list: async () => ({ rows: MESSAGE_ROWS, groups: MESSAGE_GROUPS }),
  open: async (pick): Promise<PaneThread> => {
    if (pick.kind === 'group') {
      const group = MESSAGE_GROUPS.find((g) => g.id === pick.id);
      if (!group) return { kind: 'error', error: 'That chat is not there any more.' };
      return {
        kind: 'group',
        chatId: group.id,
        title: group.title,
        members: group.members,
        former: [],
        page: { messages: group.id === GROUP_ID ? GROUP_THREAD : [], hasOlder: false, reactions: GROUP_REACTIONS },
        timezone: ZONE,
        now: NOW,
      };
    }
    const row = MESSAGE_ROWS.find((r) => pick.kind === 'person' && r.key === pick.key);
    if (!row) return { kind: 'error', error: 'That chat is not there any more.' };
    return {
      kind: 'person',
      person: { ...row, unread: false },
      page: { messages: row.id === FRANKLIN.id ? THREAD : [], hasOlder: false },
      changes: [],
      builds: {},
      timezone: ZONE,
      now: NOW,
      today: '2026-11-03',
    };
  },
};
