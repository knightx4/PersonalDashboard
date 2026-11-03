import { AppShell } from '@/components/shell/app-shell';
import { tabsFor } from '@/lib/shell/tabs';
import type { CouncilNote, Mentor } from '@/lib/you/council-model';
import { PeopleView } from '@/app/chat/people-view';

/**
 * The Chat workspace in the gallery (plan #2748.1): People, its first tab,
 * with the mentors as threads, and with none at all. The Dash
 * tab is drawn by DashPageSurface in ask-surfaces.tsx.
 */

/** Fixed, so the server's render and the browser's agree. */
const NOW = Date.parse('2026-11-03T09:00:00Z');

function note(advisorId: string, text: string, createdAt: string, read: boolean): CouncilNote {
  return {
    id: `n-${advisorId}`,
    advisorId,
    text,
    receipts: [],
    createdAt,
    readAt: read ? createdAt : null,
    reaction: null,
    reactionNote: null,
    taskId: null,
  };
}

function mentor(fields: Partial<Mentor> & Pick<Mentor, 'id' | 'key' | 'name' | 'kind' | 'question'>): Mentor {
  return { focus: null, active: true, canTalk: true, note: null, waiting: false, ...fields };
}

/** Five mentors: two unread, one writing back, one with nothing yet, and a guest whose brain is not built. */
export const CHAT_MENTORS: Mentor[] = [
  mentor({
    id: 'm1',
    key: 'cfo',
    name: 'The CFO',
    kind: 'seat',
    question: 'Can you afford it, and what does it cost you later?',
    note: note(
      'm1',
      'Your gym membership renewed at $260 this morning. You have checked in twice since August, so it is costing you $130 a visit.',
      '2026-11-03T07:12:00Z',
      false,
    ),
  }),
  mentor({
    id: 'm2',
    key: 'benjamin-franklin',
    name: 'Benjamin Franklin',
    kind: 'guest',
    question: 'What would a careful, curious man of business do here?',
    note: note(
      'm2',
      'You put the Northwind application off again yesterday. That is the third time this week. What is actually in the way?',
      '2026-11-02T18:40:00Z',
      false,
    ),
  }),
  mentor({
    id: 'm3',
    key: 'mentor',
    name: 'The Mentor',
    kind: 'seat',
    question: 'What would someone who has done this before tell you?',
    waiting: true,
    note: note('m3', 'Then let us not fix anything tonight. Tell me the one part you keep replaying.', '2026-11-01T21:05:00Z', true),
  }),
  mentor({
    id: 'm4',
    key: 'skeptic',
    name: 'The Skeptic',
    kind: 'seat',
    question: 'What would have to be true for this to be a mistake?',
  }),
  mentor({
    id: 'm5',
    key: 'richard-feynman-and-the-art-of-explaining-things-simply',
    name: 'Richard Feynman, on explaining things simply to anyone',
    kind: 'guest',
    question: 'Can you explain it to a twelve-year-old?',
    canTalk: false,
  }),
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

/** People with its mentors, with none, or not read. */
export function ChatPeopleSurface({ state = 'mentors' }: { state?: 'mentors' | 'empty' | 'failed' }) {
  return (
    <ChatShell path="/chat">
      <PeopleView
        mentors={state === 'mentors' ? CHAT_MENTORS : []}
        failed={state === 'failed'}
        timezone="Europe/London"
        now={NOW}
      />
    </ChatShell>
  );
}
