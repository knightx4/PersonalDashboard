'use client';

import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { ANSWER_CELL_PAID } from '@/components/learn/cell-answer-view';
import { HAIKU } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { RunSummary } from '@/lib/learn/levels/run';
import type { SessionItem, SessionStep, SessionTally } from '@/lib/learn/next/session';
import {
  LearnSession,
  SessionEmpty,
  SessionEnd,
  SessionLoading,
  type SessionSource,
} from '@/app/learn/go/session';

/**
 * A learning session on /learn/go (plan #2546.3), drawn from fixtures: each
 * kind of item the chooser hands it, and its hidden parts, the next item
 * being written, the end of a session, an item that could not be written, and
 * nothing at all to learn. The session's source answers from the queue below,
 * so Next brings the next fixture at once, as the real one does with the item
 * written ahead.
 */

const SUBJECT = '5e000000-0000-4000-8000-000000002546';
const PIECE = '5e000000-0000-4000-8000-000000002547';
const STARTED = '2026-10-26T09:00:00.000Z';

const cost: CostEstimate = {
  lowMicros: 2_000,
  medianMicros: 4_000,
  highMicros: 9_000,
  runs: 14,
  basis: 'measured',
  per: 'run',
  models: [HAIKU],
};

const COSTS = {
  'app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck': cost,
  'app/learn/s/[id]/p/[piece]/actions.ts#handInPractice': cost,
  'app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck': cost,
  'app/learn/review/actions.ts#answerReview': cost,
  'app/learn/review/actions.ts#askReview': cost,
  [ANSWER_CELL_PAID]: cost,
};

const line = 'Corporate strategy · Where an industry’s profits go';

const lesson: SessionItem = {
  kind: 'lesson',
  key: 'lesson:piece:five-forces',
  line,
  subjectId: SUBJECT,
  pieceId: PIECE,
  number: 2,
  idea: {
    conceptId: '5e000000-0000-4000-8000-000000002548',
    name: 'Supplier power',
    claim: 'When few suppliers sell something a business cannot do without, they take a larger share of its profit.',
    dropped: null,
    lesson: {
      takeaway:
        'The fewer the suppliers and the harder they are to replace, the more of an industry’s profit they can take for themselves.',
      context:
        'Airlines make thin margins while the two companies that build large jet engines make wide ones, although both sell to the same passengers in the end.',
      hook: null,
      summary:
        'Suppliers have power when there are few of them, when switching away costs the buyer a lot, and when what they sell makes up a large part of the buyer’s product. They use it by raising prices or cutting quality, and the buyer cannot pass all of that on.',
      example:
        'A chipmaker that is the only source of a phone’s processor can raise its price by a fifth. The phone maker either pays it and earns less on each phone, or redesigns the phone around another chip, which takes two years.',
      question: 'A bakery buys flour from any of a dozen mills. Is its flour supplier strong or weak?',
      answer: 'Weak: there are many mills, flour is much the same from each, and the bakery can switch next week.',
      figures: [],
    },
  },
};

const levelLesson: SessionItem = {
  kind: 'level_lesson',
  key: 'level_lesson:cell-moat-3',
  line: 'Competitive advantage',
  lesson: {
    id: '5e000000-0000-4000-8000-000000002554',
    cellId: 'cell-moat-3',
    topicId: 'tp-adv',
    topicName: 'Competitive advantage',
    level: 3,
    read: false,
    dropped: null,
    lesson: {
      takeaway: 'An advantage lasts only as long as a rival cannot copy it at a cost that still pays.',
      context: 'Plenty of firms earn more than their rivals for a year or two. The question at this level is why some still do ten years later.',
      hook: null,
      summary:
        'Low prices, a good product or a clever campaign can all be copied. What lasts is something a rival cannot buy or build quickly: a site, a licence, a network of users, or costs that fall as volume grows.',
      example:
        'Two ferry companies run the same crossing. One owns the only deep-water berth at both ends, so the other has to use smaller boats and charge more per car.',
      question: null,
      answer: null,
      figures: [],
    },
  },
};

const check: SessionItem = {
  kind: 'check',
  key: `check:${PIECE}`,
  line: `${line} · Porter’s five forces, level 3`,
  subjectId: SUBJECT,
  pieceId: PIECE,
  practicePassed: false,
  check: {
    id: '5e000000-0000-4000-8000-000000002549',
    question:
      'A hospital group buys its scanners from one of two makers, and each scanner needs that maker’s own parts and engineers for ten years. Who holds the power in that relationship, and what would change it?',
    expected: null,
    response: null,
    correct: null,
    why: null,
    cell: { topicId: 'tp-five', topicName: 'Porter’s five forces', level: 3 },
  },
};

const question: SessionItem = {
  kind: 'question',
  key: 'question:cell-moat-4',
  line: 'Competitive advantage · level 4',
  asked: {
    questionId: '5e000000-0000-4000-8000-000000002550',
    topicName: 'Competitive advantage',
    level: 4,
    question:
      'A regional grocer has the lowest prices in its towns because it owns its warehouses outright. A national chain opens next door with prices 3% lower. Explain whether the grocer’s advantage survives, and what it would need to be true for it to.',
    format: 'explain',
    why: 'On the edge of what you hold in Competitive advantage: you showed level 3 last week, and level 4 is the next one up.',
  },
};

const review: SessionItem = {
  kind: 'review',
  key: 'review:switching-costs',
  line: 'Corporate strategy · How buyers get locked in',
  review: {
    conceptId: '5e000000-0000-4000-8000-000000002551',
    name: 'Switching costs',
    subjectId: SUBJECT,
    trackName: 'Corporate strategy',
    pieceId: PIECE,
    pieceTitle: 'How buyers get locked in',
    dueOn: '2026-10-24',
    open: {
      id: '5e000000-0000-4000-8000-000000002552',
      question: 'Why can a company that sells accounting software raise its prices each year without losing many customers?',
      expected: null,
      response: null,
      correct: null,
      why: null,
    },
  },
};

const task: SessionItem = {
  kind: 'task',
  key: `task:${PIECE}`,
  line,
  subjectId: SUBJECT,
  pieceId: PIECE,
  checkPassed: true,
  practice: {
    id: '5e000000-0000-4000-8000-000000002553',
    task: 'A coffee chain buys its beans from three importers and its espresso machines from one maker, who also services them. Rate each supplier’s power from 1 to 5 and say which one the chain should worry about first.',
    data: {
      columns: ['Supplier', 'Share of costs', 'Others who could supply it'],
      rows: [
        ['Beans', '18%', '40+'],
        ['Machines and servicing', '7%', '1'],
        ['Milk', '9%', '12'],
      ],
    },
    figures: [],
    spreadsheetNote: null,
    worked: null,
    passed: false,
    latest: null,
  },
};

const failed: SessionItem = {
  kind: 'failed',
  key: `task:${PIECE}-failed`,
  line,
  was: 'task',
  error: 'Writing the task failed: the model took longer than a minute to answer.',
};

const ended: RunSummary = {
  answered: 3,
  shown: [
    { cellId: 'adv3', topicId: 'adv', topicName: 'Competitive advantage', level: 3 },
    { cellId: 'five3', topicId: 'five', topicName: 'Porter’s five forces', level: 3 },
  ],
  implied: [
    { cellId: 'five1', topicId: 'five', topicName: 'Porter’s five forces', level: 1 },
    { cellId: 'five2', topicId: 'five', topicName: 'Porter’s five forces', level: 2 },
  ],
  missed: [{ cellId: 'adv4', topicId: 'adv', topicName: 'Competitive advantage', level: 4 }],
  doubted: [],
};

const endedTally: SessionTally = { lesson: 2, check: 1, question: 2, review: 1 };

/** Answers from the fixtures in order after the one drawn first, then says nothing is left. */
function fixtureSource(queue: readonly SessionItem[]): SessionSource {
  return {
    next: async (skip) => {
      const item = queue.find((one) => !skip.includes(one.key)) ?? null;
      return { ok: true, item } satisfies SessionStep;
    },
    shown: () => undefined,
    end: async () => ({ summary: ended }),
  };
}

const ORDER: readonly SessionItem[] = [lesson, check, task, levelLesson, question, review];

function Session({ first }: { first: SessionItem }) {
  const queue = [first, ...ORDER.filter((one) => one.key !== first.key)];
  return (
    <PaidCostsProvider costs={COSTS}>
      <LearnSession startedAt={STARTED} first={{ ok: true, item: first }} source={fixtureSource(queue)} />
    </PaidCostsProvider>
  );
}

export type LearnGoState = 'lesson' | 'level-lesson' | 'check' | 'question' | 'review' | 'task' | 'loading' | 'end' | 'failed' | 'empty';

export function LearnGoSurface({ state }: { state: LearnGoState }) {
  switch (state) {
    case 'lesson':
      return <Session first={lesson} />;
    case 'level-lesson':
      return <Session first={levelLesson} />;
    case 'check':
      return <Session first={check} />;
    case 'question':
      return <Session first={question} />;
    case 'review':
      return <Session first={review} />;
    case 'task':
      return <Session first={task} />;
    case 'failed':
      return <Session first={failed} />;
    case 'loading':
      return <SessionLoading onStop={() => undefined} />;
    case 'end':
      return (
        <SessionEnd
          startedAt={STARTED}
          tally={endedTally}
          nothingLeft={false}
          source={fixtureSource([])}
          summary={{ summary: ended }}
        />
      );
    case 'empty':
      return <SessionEmpty />;
  }
}
