'use client';

import {
  AdvisorsView,
  type AddStart,
  type AdvisorActions,
} from '@/app/you/board/advisors/advisors-view';
import { PREVIEW_PANELS } from './you-board-surfaces';
import { BoardListSkeleton } from '@/app/you/board/board-skeleton';
import { PanelView } from '@/app/you/board/advisors/panels/[id]/panel-view';
import type { RosterAdvisor } from '@/lib/you/board-advisors';

/**
 * The Advisors view of the Board tab in the gallery (plan #2561.7): the roster
 * with every guest ready and one switched off, a brain being built, a build
 * that failed with its retry, the Add advisor card open, and the loading
 * state. The fixtures are invented and run as long as a real roster does.
 */

const NOW = Date.parse('2026-11-02T10:00:00Z');

const actions: AdvisorActions = {
  add: async () => ({ error: null, saved: true }),
  retry: async () => ({ error: null }),
  setActive: async () => ({ error: null }),
  createPanel: async () => ({ error: null, panelId: PREVIEW_PANELS[0].id }),
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
    ...over,
  };
}

const seats: RosterAdvisor[] = [
  advisor({
    key: 'hiring_manager',
    name: 'Hiring manager',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Would I interview you for the roles you are applying to?',
    focus: 'This month: the pipeline, where each application stalled, and how your materials read.',
  }),
  advisor({
    key: 'mentor',
    name: 'Mentor',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Does this build toward a career you would want in ten years?',
    focus: 'Five to ten years: what you are building, and what you are not.',
  }),
  advisor({
    key: 'skeptic',
    name: 'Skeptic',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'Do your hours match what you say matters?',
    focus: 'Right now: stated priorities beside where the time went.',
  }),
  advisor({
    key: 'cfo',
    name: 'CFO',
    kind: 'seat',
    brainStatus: 'none',
    sources: 0,
    question: 'What does this cost, and can you afford it?',
    focus: 'Six to twelve months: spending, runway and income.',
  }),
  advisor({
    key: 'dreamer',
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
    name: 'Warren Buffett',
    question: 'Will you still be glad of this in twenty years?',
    focus: 'Long-term value, staying inside what you understand, and a margin of safety.',
    sources: 14,
  }),
  advisor({
    key: 'da_vinci',
    name: 'Leonardo da Vinci',
    question: 'What would you notice if you studied this with real curiosity?',
    focus: 'Close observation, curiosity across fields, and sketching ideas before committing.',
    sources: 11,
    active: false,
  }),
  advisor({
    key: 'dalio',
    name: 'Ray Dalio',
    question: 'What principle would you follow here every time, and what does the evidence say?',
    focus: 'Principles, honest reflection on mistakes, and weighing views by who has been right.',
    sources: 16,
  }),
  advisor({
    key: 'dimon',
    name: 'Jamie Dimon',
    question: 'Can you carry this out, and what happens if it goes wrong?',
    focus: 'Execution, facing hard facts early, and preparing for the bad case.',
    sources: 13,
  }),
  advisor({
    key: 'jobs',
    name: 'Steve Jobs',
    question: 'Is this the one thing worth doing, and are you willing to say no to the rest?',
    focus: 'Focus, saying no, and the care put into the work itself.',
    sources: 15,
  }),
  advisor({
    key: 'washington',
    name: 'George Washington',
    question: 'Does this keep your word and your reputation intact under pressure?',
    focus: 'Duty, restraint, character, and knowing when to step back.',
    sources: 10,
  }),
  advisor({
    key: 'franklin',
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
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Board', href: '/you/board' },
          { label: 'Advisors', href: '/you/board/advisors' },
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
    state === 'empty' ? { id: PREVIEW_PANELS[0].id, name: 'New panel', advisors: [] } : PREVIEW_PANELS[0];
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
          { label: 'Board', href: '/you/board' },
          { label: 'Advisors', href: '/you/board/advisors' },
          { label: panel.name, href: `/you/board/advisors/panels/${panel.id}` },
        ],
      }}
    />
  );
}
