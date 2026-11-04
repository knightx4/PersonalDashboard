'use client';

import {
  AdvisorsView,
  type AddStart,
  type AdvisorActions,
} from '@/app/you/advisors/advisors/advisors-view';
import { PREVIEW_PANELS } from './you-board-surfaces';
import { BoardListSkeleton } from '@/app/you/advisors/board-skeleton';
import { PanelView } from '@/app/you/advisors/advisors/panels/[id]/panel-view';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import { avatarFor } from '@/lib/you/advisor-avatar';
import type { Drawn } from '@/app/you/advisors/avatar-editor';
import { ProfileView, type ProfileActions } from '@/app/you/advisors/advisors/[key]/profile-view';
import type { Brain } from '@/lib/you/board-brain';
import { advisorHref, type AdvisorDecision, type AdvisorTab } from '@/lib/you/board-profile';
import { trackRecords, type TrackRecord } from '@/lib/you/board-scoring';

/**
 * The Advisors view of the Advisors tab in the gallery (plan #2561.7): the roster
 * with every guest ready and one switched off, a brain being built, a build
 * that failed with its retry, the Add advisor card open, and the loading
 * state. The fixtures are invented and run as long as a real roster does.
 */

const NOW = Date.parse('2026-11-02T10:00:00Z');

const actions: AdvisorActions = {
  add: async () => ({ error: null, saved: true }),
  createPanel: async () => ({ error: null, panelId: PREVIEW_PANELS[0].id }),
  startMeeting: async () => ({ error: null }),
};

function advisor(over: Partial<RosterAdvisor> & Pick<RosterAdvisor, 'key' | 'name' | 'question'>): RosterAdvisor {
  return {
    id: `00000000-0000-4000-8000-${over.key.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/g, '0')}`,
    kind: 'guest',
    focus: null,
    brainStatus: 'ready',
    failure: null,
    sources: 12,
    active: true,
    addedBy: 'person',
    updatedAt: '2026-10-30T09:00:00Z',
    avatar: avatarFor(over.key, null),
    assessment: null,
    ...over,
  };
}

const seats: RosterAdvisor[] = [
  advisor({
    key: 'hiring_manager',
    assessment: 'Would they shortlist you',
    name: 'Hiring manager',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Would I interview you for the roles you are applying to?',
    focus: 'This month: the pipeline, where each application stalled, and how your materials read.',
  }),
  advisor({
    key: 'mentor',
    assessment: 'Career capital in ten years',
    name: 'Mentor',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Does this build toward a career you would want in ten years?',
    focus: 'Five to ten years: what you are building, and what you are not.',
  }),
  advisor({
    key: 'skeptic',
    assessment: 'Hours against what you say matters',
    name: 'Skeptic',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Do your hours match what you say matters?',
    focus: 'Right now: stated priorities beside where the time went.',
  }),
  advisor({
    key: 'cfo',
    assessment: 'Months of runway',
    name: 'CFO',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'What does this cost, and can you afford it?',
    focus: 'Six to twelve months: spending, runway and income.',
  }),
  advisor({
    key: 'dreamer',
    assessment: 'Which dream it feeds',
    name: 'Dreamer',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Which dream does this keep alive, or quietly drop?',
    focus: 'No horizon: the big ambitions in your own notes, and the smallest thread that keeps one going.',
  }),
];

const guests: RosterAdvisor[] = [
  advisor({
    key: 'buffett',
    assessment: 'The twenty-year owner’s test',
    name: 'Warren Buffett',
    question: 'Will you still be glad of this in twenty years?',
    focus: 'Long-term value, staying inside what you understand, and a margin of safety.',
    sources: 14,
  }),
  advisor({
    key: 'da_vinci',
    assessment: 'What close looking would show',
    name: 'Leonardo da Vinci',
    question: 'What would you notice if you studied this with real curiosity?',
    focus: 'Close observation, curiosity across fields, and sketching ideas before committing.',
    sources: 11,
    active: false,
  }),
  advisor({
    key: 'dalio',
    assessment: 'The principle you would follow every time',
    name: 'Ray Dalio',
    question: 'What principle would you follow here every time, and what does the evidence say?',
    focus: 'Principles, honest reflection on mistakes, and weighing views by who has been right.',
    sources: 16,
  }),
  advisor({
    key: 'dimon',
    assessment: 'Can you execute it and survive the bad case',
    name: 'Jamie Dimon',
    question: 'Can you carry this out, and what happens if it goes wrong?',
    focus: 'Execution, facing hard facts early, and preparing for the bad case.',
    sources: 13,
  }),
  advisor({
    key: 'jobs',
    assessment: 'The one thing, loved enough to last',
    name: 'Steve Jobs',
    question: 'Is this the one thing worth doing, and are you willing to say no to the rest?',
    focus: 'Focus, saying no, and the care put into the work itself.',
    sources: 15,
  }),
  advisor({
    key: 'washington',
    assessment: 'Whether your word survives it',
    name: 'George Washington',
    question: 'Does this keep your word and your reputation intact under pressure?',
    focus: 'Duty, restraint, character, and knowing when to step back.',
    sources: 10,
  }),
  advisor({
    key: 'franklin',
    assessment: 'Useful, and better by the day',
    name: 'Benjamin Franklin',
    question: 'Is this useful, and does it make you better day by day?',
    focus: 'Practical habits, thrift, hard work and steady self-improvement.',
    sources: 12,
  }),
];

const building = advisor({
  key: 'aurelius',
  name: 'Marcus Aurelius',
  question: 'What would Marcus Aurelius make of this?',
  focus: 'How to act well when you do not control the outcome.',
  brainStatus: 'building',
  sources: 0,
  updatedAt: '2026-11-02T09:40:00Z',
});

const failed = advisor({
  key: 'aurelius',
  name: 'Marcus Aurelius',
  question: 'What would Marcus Aurelius make of this?',
  focus: 'How to act well when you do not control the outcome.',
  brainStatus: 'failed',
  sources: 0,
  failure:
    'Only seven of the twelve sources opened, and a brain needs ten. Two pages were behind a login and three links were dead.',
  updatedAt: '2026-11-02T08:10:00Z',
});

/** Track records for some of the roster: two seats and a guest have been scored. */
const RECORDS: TrackRecord[] = trackRecords([
  {
    key: 'cfo',
    name: 'CFO',
    believability: {
      money: { scored: 6, brier: 0.08, updated_at: '2026-10-30T09:00:00Z' },
      work: { scored: 3, brier: 0.14, updated_at: '2026-10-30T09:00:00Z' },
    },
  },
  {
    key: 'mentor',
    name: 'Mentor',
    believability: { work: { scored: 4, brier: 0.21, updated_at: '2026-10-30T09:00:00Z' } },
  },
  {
    key: 'buffett',
    name: 'Warren Buffett',
    believability: {
      money: { scored: 5, brier: 0.11, updated_at: '2026-10-30T09:00:00Z' },
      work: { scored: 2, brier: 0.31, updated_at: '2026-10-30T09:00:00Z' },
    },
  },
]);

export function YouBoardAdvisorsPreview({
  state = 'ready',
  start,
}: {
  state?: 'ready' | 'building' | 'failed';
  start?: AddStart;
}) {
  const extra = state === 'building' ? [building] : state === 'failed' ? [failed] : [];
  return (
    <AdvisorsView
      advisors={[...seats, ...guests, ...extra]}
      panels={PREVIEW_PANELS}
      now={NOW}
      actions={actions}
      start={start}
      records={Object.fromEntries(RECORDS.map((r) => [r.advisor, r]))}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Advisors', href: '/you/advisors' },
          { label: 'Roster', href: '/you/advisors/advisors' },
        ],
      }}
    />
  );
}

export function YouBoardAdvisorsLoadingPreview() {
  return <BoardListSkeleton />;
}

const panelActions = {
  rename: async () => ({ error: null }),
  setAdvisors: async () => ({ error: null }),
  remove: async () => ({ error: null }),
};

/** One panel's page: the seeded Money panel, a panel just made with no advisors, or the delete confirm showing. */
export function YouBoardPanelPreview({ state = 'ready' }: { state?: 'ready' | 'empty' | 'delete' }) {
  const panel =
    state === 'empty' ? { id: PREVIEW_PANELS[0].id, name: 'New panel', advisors: [], topic: null } : PREVIEW_PANELS[0];
  return (
    <PanelView
      panel={panel}
      roster={[...seats, ...guests]}
      actions={panelActions}
      armDelete={state === 'delete'}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Advisors', href: '/you/advisors' },
          { label: 'Roster', href: '/you/advisors/advisors' },
          { label: panel.name, href: `/you/advisors/advisors/panels/${panel.id}` },
        ],
      }}
    />
  );
}

const profileActions: ProfileActions = {
  retry: async () => ({ error: null }),
  setActive: async () => ({ error: null }),
  drawAvatar: async () => ({ error: 'The gallery does not draw new looks.' }),
  saveAvatar: async () => ({ error: null }),
};

const BUFFETT_BRAIN: Brain = {
  version: 2,
  assessment: {
    name: 'The twenty-year owner’s test',
    text: 'Rates each option as if you had to own it, without selling, for twenty years: do you understand it well enough to say in plain words why it will be worth more in five, ten and twenty years, does it build an advantage that lasts without being re-won every month, and could it ever wipe you out. A good option sits inside your circle of competence and compounds quietly. A poor one is exciting, outside the circle, or carries even a small chance of ruin.',
  },
  evidence: ['Your own record inside the field', 'The people you would be partnered with', 'The worst plausible case'],
  questions: [
    'Could you explain in one paragraph why this is worth more in ten years?',
    'Who would you be working with, and would you trust them with your savings?',
    'What is the one way this could wipe you out?',
    'Would you still want it if nobody could see you had it?',
  ],
  rules: [
    'Stay inside the circle of competence, and know where its edge is.',
    'Never risk what you have and need for what you do not have and do not need.',
    'Price is what you pay; value is what you get.',
    'Work with people you like, trust and admire.',
    'The best investment you can make is in yourself.',
    'Be fearful when others are greedy and greedy when others are fearful.',
    'Time is the friend of the wonderful business and the enemy of the mediocre one.',
    'Keep enough cash that you never have to sell at the wrong moment.',
  ],
  frameworks: [
    {
      name: 'Circle of competence',
      text: 'Draw the circle honestly: what you know well enough to be right more often than the market. Inside it, act boldly; outside it, pass.',
    },
    {
      name: 'Margin of safety',
      text: 'Only take a bet with enough room for error that being wrong about the details still leaves you whole.',
    },
    {
      name: 'The inner scorecard',
      text: 'Judge a choice by whether you would be content with it if the world thought it a mistake.',
    },
  ],
  positions: [],
  contrarian: [],
  disagreements: [],
  stories: [],
  never: [],
  voice:
    'Plain Midwestern prose with short, memorable lines and exact numbers. Self-deprecating about his own errors and generous about other people’s work. Reaches for homely analogies (cigar butts, farms, weeds and flowers) and avoids jargon.',
  sources: [
    { label: 'Berkshire Hathaway shareholder letters, 1965 to 2024', link: 'https://www.berkshirehathaway.com/letters/letters.html' },
    { label: 'The Superinvestors of Graham-and-Doddsville (1984)', link: 'https://www8.gsb.columbia.edu/sites/valueinvesting/files/files/Buffett1984.pdf' },
    { label: 'Talk to University of Florida MBA students, 1998', link: 'https://www.youtube.com/watch?v=r7Ra2bKrc8U' },
    { label: 'The Snowball, Alice Schroeder (2008)', link: 'https://en.wikipedia.org/wiki/The_Snowball:_Warren_Buffett_and_the_Business_of_Life' },
    { label: 'Berkshire annual meeting transcripts, CNBC archive', link: 'https://buffett.cnbc.com/annual-meetings/' },
    { label: 'Letter to the Graham-Newman partners on owner earnings', link: 'https://www.berkshirehathaway.com/letters/1986.html' },
    { label: 'Interview with Charlie Rose, 2008', link: 'https://charlierose.com/videos/11586' },
    { label: 'The Essays of Warren Buffett, ed. Lawrence Cunningham', link: 'https://www.cunninghambooks.com/the-essays-of-warren-buffett' },
    { label: 'Fortune: Mr. Buffett on the stock market (1999)', link: 'https://money.cnn.com/magazines/fortune/fortune_archive/1999/11/22/269071/' },
    { label: 'Partnership letters, 1957 to 1970', link: 'https://www.ivey.uwo.ca/media/2975913/buffett-partnership-letters.pdf' },
    { label: 'Your note: what I want money for', link: '/vault/n/00000000-0000-4000-8000-0000000000a1' },
  ],
};

const DECISIONS: AdvisorDecision[] = [
  {
    questionId: 'q-offer',
    meetingId: '00000000-0000-4000-8000-00000000d001',
    question: 'Should I take the Northwind analyst offer, or hold out for a strategy role at a bank?',
    options: [
      { letter: 'A', text: 'Take the Northwind offer' },
      { letter: 'B', text: 'Hold out for a strategy role' },
    ],
    forecast: { A: 0.72, B: 0.41 },
    pick: 'A',
    chosen: 'A',
    decidedAt: '2026-08-14T09:00:00Z',
    outcome: 'well',
    brier: 0.08,
    askedAt: '2026-08-10T09:00:00Z',
  },
  {
    questionId: 'q-course',
    meetingId: '00000000-0000-4000-8000-00000000d002',
    question: 'Pay £1,800 for the CFA Level I course now, or study from the free curriculum first?',
    options: [
      { letter: 'A', text: 'Pay for the course' },
      { letter: 'B', text: 'Study from the free curriculum' },
      { letter: 'C', text: 'Put it off a year' },
    ],
    forecast: { A: 0.35, B: 0.64, C: 0.2 },
    pick: 'B',
    chosen: 'A',
    decidedAt: '2026-09-02T09:00:00Z',
    outcome: 'badly',
    brier: 0.12,
    askedAt: '2026-09-01T09:00:00Z',
  },
  {
    questionId: 'q-move',
    meetingId: '00000000-0000-4000-8000-00000000d003',
    question: 'Move to Leeds for the cheaper rent, or stay in London near the work?',
    options: [
      { letter: 'A', text: 'Move to Leeds' },
      { letter: 'B', text: 'Stay in London' },
    ],
    forecast: { A: 0.58, B: 0.47 },
    pick: 'A',
    chosen: 'B',
    decidedAt: '2026-10-20T09:00:00Z',
    outcome: null,
    brier: null,
    askedAt: '2026-10-18T09:00:00Z',
  },
  {
    questionId: 'q-side',
    meetingId: '00000000-0000-4000-8000-00000000d004',
    question: 'Spend evenings on the property side project, or on applications?',
    options: [
      { letter: 'A', text: 'The side project' },
      { letter: 'B', text: 'Applications' },
    ],
    forecast: null,
    pick: 'B',
    chosen: null,
    decidedAt: null,
    outcome: null,
    brier: null,
    askedAt: '2026-06-01T09:00:00Z',
  },
];

/**
 * One advisor's profile (plan #2581.5): Warren Buffett with his brain, record
 * and decisions on each tab; with nothing scored yet; a brain being built; a
 * build that failed; and his look open to change.
 */
export function YouBoardAdvisorProfilePreview({
  tab = 'about',
  state = 'ready',
  editing,
}: {
  tab?: AdvisorTab;
  state?: 'ready' | 'empty' | 'building' | 'failed';
  editing?: Drawn;
}) {
  const base = guests.find((g) => g.key === 'buffett')!;
  const advisor =
    state === 'building' ? building : state === 'failed' ? failed : base;
  const ready = state === 'ready' || state === 'empty';
  const record = state === 'ready' ? (RECORDS.find((r) => r.advisor === 'buffett') ?? null) : null;
  return (
    <ProfileView
      advisor={advisor}
      brain={ready ? BUFFETT_BRAIN : null}
      record={record}
      decisions={state === 'ready' ? DECISIONS : []}
      tab={tab}
      now={NOW}
      actions={profileActions}
      editing={editing ?? null}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Advisors', href: '/you/advisors' },
          { label: 'Roster', href: '/you/advisors/advisors' },
          { label: advisor.name, href: advisorHref(advisor.key) },
        ],
      }}
    />
  );
}
