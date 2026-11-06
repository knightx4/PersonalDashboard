'use client';

import { CouncilSkeleton } from '@/app/you/council/board-skeleton';
import { CouncilView } from '@/app/you/council/council-view';
import { MentorView, type MentorActions } from '@/app/you/council/mentors/[key]/mentor-view';
import type { NoteActions } from '@/app/you/council/note-card';
import type { Brain } from '@/lib/you/board-brain';
import type { CouncilMemory, CouncilMessage, CouncilNote, Mentor, MentorWatch } from '@/lib/you/council-model';

/**
 * The Council in the gallery (you 0037): the home with three unread texts in
 * Chat (plan #2748.7), with none, and held back at six unread; and one mentor's page mid-talk, waiting on a
 * reply, and opened from a note. The fixtures are invented, sixteen mentors
 * long like the real council.
 */

const NOW = Date.parse('2026-11-02T15:00:00Z');
const ZONE = 'America/New_York';
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const noteActions: NoteActions = {
  read: async () => ({ error: null }),
  react: async () => ({ error: null }),
  todo: async () => ({ error: null }),
};

const mentorActions: MentorActions = {
  ...noteActions,
  readMentor: async () => ({ error: null }),
  send: async () => ({ error: null, saved: true }),
  commitment: async () => ({ error: null }),
  forget: async () => ({ error: null }),
  stopWatch: async () => ({ error: null }),
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ROSTER: [string, string, 'seat' | 'guest', string][] = [
  ['hiring_manager', 'Hiring manager', 'seat', 'Would I interview you for the roles you are applying to?'],
  ['mentor', 'Jerwyn the Elder', 'seat', 'Does this build toward a career you would want in ten years?'],
  ['skeptic', 'Skeptic', 'seat', 'Do your hours match what you say matters?'],
  ['cfo', 'CFO', 'seat', 'What does this cost, and can you afford it?'],
  ['dreamer', 'Dreamer', 'seat', 'Which dream does this keep alive, or quietly drop?'],
  ['buffett', 'Warren Buffett', 'guest', 'Will you still be glad of this in twenty years?'],
  ['da_vinci', 'Leonardo da Vinci', 'guest', 'What would you notice if you studied this with real curiosity?'],
  ['dalio', 'Ray Dalio', 'guest', 'What principle would you follow here every time, and what does the evidence say?'],
  ['dimon', 'Jamie Dimon', 'guest', 'Can you carry this out, and what happens if it goes wrong?'],
  ['franklin', 'Benjamin Franklin', 'guest', 'Is this useful, and does it make you better day by day?'],
  ['jobs', 'Steve Jobs', 'guest', 'Is this the one thing worth doing, and are you willing to say no to the rest?'],
  ['marcus_aurelius', 'Marcus Aurelius', 'guest', 'Is this within your control, and are you acting well on it?'],
  ['feynman', 'Richard Feynman', 'guest', 'Could you explain this simply, and are you fooling yourself?'],
  ['seneca', 'Seneca', 'guest', 'Are you spending your time as if it were the one thing you cannot get back?'],
  ['socrates', 'Socrates', 'guest', 'What do you actually know here, and what are you assuming?'],
  ['washington', 'George Washington', 'guest', 'Does this keep your word and your reputation intact under pressure?'],
];

const TEXTS: Record<string, string> = {
  hiring_manager:
    'Brex replied in two days and you have not answered. A reply that fast means a person read your note; answer today while they remember it.',
  cfo: 'Your recurring payments rose by $64 in October. Three of them you have not opened since August.',
  dreamer:
    'Your Ableton note from 9 September has not been touched since. One hour this week keeps it alive, even if the song never ships.',
  feynman:
    'You saved four linear algebra readings this week and finished none. Pick the shortest and explain eigenvectors back to yourself in a page.',
  mentor:
    'Last Tuesday you said you would send two cold emails to finance teams by Friday. How did it go, and what did you learn from whoever answered?',
  seneca: 'You wrote "no time" three times in your daily notes this week. Count the hours you spent on the dashboard before you believe it.',
};

function noteFor(key: string, n: number, hours: number, read = false): CouncilNote {
  return {
    id: id(100 + n),
    advisorId: id(n),
    text: TEXTS[key] ?? 'One thing worth saying.',
    receipts: [
      { label: key === 'cfo' ? 'Recurring payments' : key === 'hiring_manager' ? 'Brex, Strategy & Ops' : 'The note', link: '/you' },
    ],
    createdAt: ago(hours),
    readAt: read ? ago(hours - 1) : null,
    reaction: null,
    reactionNote: null,
    taskId: null,
  };
}

function mentors(withNotes: Record<string, { hours: number; read?: boolean }>): Mentor[] {
  return ROSTER.map(([key, name, kind, question], n) => {
    const at = withNotes[key];
    return {
      id: id(n),
      key,
      name,
      kind,
      question,
      focus: null,
      active: true,
      canTalk: key !== 'socrates',
      note: at ? noteFor(key, n, at.hours, at.read) : null,
      waiting: key === 'mentor',
    };
  });
}

const WITH_NOTES = {
  hiring_manager: { hours: 3 },
  cfo: { hours: 4 },
  feynman: { hours: 5 },
  mentor: { hours: 30, read: true },
  dreamer: { hours: 50, read: true },
  seneca: { hours: 75, read: true },
};

export function YouCouncilPreview({ state = 'notes' }: { state?: 'notes' | 'empty' | 'held' }) {
  const list =
    state === 'empty'
      ? mentors({})
      : state === 'held'
        ? mentors(
            Object.fromEntries(Object.keys(WITH_NOTES).map((k, i) => [k, { hours: 6 + i * 10 }])) as typeof WITH_NOTES,
          )
        : mentors(WITH_NOTES);
  // Unread texts in Chat (plan #2748.7): one from each mentor with a fresh note, six when held back.
  const unreadTexts = list.filter((m) => m.note && !m.note.readAt).length;
  return (
    <CouncilView
      mentors={list}
      unreadTexts={unreadTexts}
      due={state === 'notes' ? 1 : 0}
      timezone={ZONE}
      now={NOW}
      subject={{ ref: null, path: [{ label: 'You', href: '/you' }, { label: 'Council', href: '/you/council' }] }}
    />
  );
}

export function YouCouncilLoadingPreview() {
  return <CouncilSkeleton />;
}

const BRAIN: Brain = {
  version: 2,
  assessment: { name: 'The ten-year test', text: 'Whether a choice builds something you will still want in ten years, or only gets you the next job.' },
  evidence: [],
  questions: ['What are you building that compounds?', 'What will you wish you had started this year?', 'Who are you becoming by doing this?'],
  rules: ['Judge a year by what it made possible, not by what it filled.', 'A skill learned slowly lasts longer than a title won quickly.'],
  frameworks: [],
  positions: [],
  contrarian: [],
  disagreements: [],
  stories: [],
  never: [],
  voice: 'Slow, warm and direct. Asks more than he tells, and remembers what you said last time.',
  sources: [
    { label: 'Mentoring research', link: 'https://example.com' },
    { label: 'Career capital', link: 'https://example.com' },
  ],
};

const MESSAGES: CouncilMessage[] = [
  {
    id: id(201),
    role: 'person',
    text: 'Should I keep applying to strategy roles, or spend November on the master\'s applications?',
    receipts: [],
    createdAt: ago(48),
    noteId: null,
  },
  {
    id: id(202),
    role: 'advisor',
    text:
      'Both are next steps, and you have been living in next steps since August. The master\'s is the one that changes what you can do in five years. Give it the mornings until 15 November and send two applications a week in the afternoons. Can you hold to that until the deadline?',
    receipts: [{ label: 'Goal: apply to the predoc programmes', link: '/goals' }],
    createdAt: ago(47),
    noteId: null,
  },
  {
    id: id(203),
    role: 'person',
    text: 'Yes. Mornings for the statement of purpose, two job applications a week.',
    receipts: [],
    createdAt: ago(46),
    noteId: null,
  },
];

const MEMORY: CouncilMemory[] = [
  { id: id(301), kind: 'commitment', text: 'Mornings on the statement of purpose until 15 November', dueOn: '2026-11-15', doneAt: null, createdAt: ago(46) },
  { id: id(302), kind: 'commitment', text: 'Send two cold emails to finance teams', dueOn: '2026-10-30', doneAt: null, createdAt: ago(200) },
  { id: id(303), kind: 'commitment', text: 'Ask Priya for a reference', dueOn: null, doneAt: ago(100), createdAt: ago(300) },
  { id: id(304), kind: 'preference', text: 'Wants to be told plainly when he is drifting', dueOn: null, doneAt: null, createdAt: ago(300) },
  { id: id(305), kind: 'open_thread', text: 'Whether to study cities and land in the economics programme', dueOn: null, doneAt: null, createdAt: ago(46) },
];

const WATCHES: MentorWatch[] = [
  { id: id(351), about: 'Vault notes that mention your sister', sendsWhen: 'A new note names her', everyDays: 1, status: 'active', lastRunAt: ago(20), lastError: null },
  { id: id(352), about: 'Job posts saved for a company with no cold email sent to anyone there', sendsWhen: 'A saved post has gone a week with no email', everyDays: 7, status: 'active', lastRunAt: null, lastError: null },
  { id: id(353), about: 'Receipts over 200 dollars with no category', sendsWhen: 'A new one appears', everyDays: 3, status: 'paused', lastRunAt: ago(70), lastError: 'The last three checks could not read your receipts.' },
  { id: id(354), about: 'Events in your calendar with no travel time', sendsWhen: 'One is added', everyDays: 14, status: 'stopped', lastRunAt: ago(400), lastError: null },
];

export function YouCouncilMentorPreview({ state = 'talk' }: { state?: 'talk' | 'waiting' | 'about' }) {
  const all = mentors(WITH_NOTES);
  const mentor = { ...all[1], waiting: state === 'waiting' };
  const notes = [mentor.note!, { ...noteFor('mentor', 1, 200, true), id: id(150), text: 'You have saved thirty job posts this month and written none of your own words about what you want. Write one paragraph before the next application.' }];
  const chat = {
    id: id(400),
    replyStatus: state === 'waiting' ? ('waiting' as const) : ('idle' as const),
    replyRequestedAt: state === 'waiting' ? ago(0.05) : null,
    replyError: null,
  };
  const messages =
    state === 'waiting'
      ? [
          ...MESSAGES,
          { id: id(204), role: 'person' as const, text: 'I missed the cold emails. I keep putting them off.', receipts: [], createdAt: ago(0.05), noteId: null },
        ]
      : MESSAGES;
  return (
    <MentorView
      mentor={mentor}
      brain={BRAIN}
      notes={notes}
      chat={chat}
      messages={messages}
      memory={MEMORY}
      watches={WATCHES}
      about={state === 'about' ? notes[0] : null}
      timezone={ZONE}
      now={NOW}
      actions={mentorActions}
      draft={state === 'about' ? 'Not yet. I sent one and lost my nerve on the second.' : ''}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Council', href: '/you/council' },
          { label: mentor.name, href: '/you/council/mentors/mentor' },
        ],
      }}
    />
  );
}
