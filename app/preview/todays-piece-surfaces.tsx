import type { ReactNode } from 'react';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS } from '@/lib/core/models';
import type { ExplanationMarking, Marking } from '@/lib/learn/feed/teach-back';
import type { PieceIdea } from '@/lib/learn/lessons/piece-store';
import {
  checkedTurn,
  checkTurn,
  explainedTurn,
  explainTurn,
  followedUpTurn,
  type PieceTalkState,
} from '@/lib/learn/lessons/piece-talk';
import type { TodaysPiece } from '@/lib/learn/lessons/todays-piece-store';
import type { TalkTurn } from '@/lib/talk/talk';
import { PieceFirst } from '@/app/learn/now/todays-piece';
import { SummaryView } from '@/app/learn/flow/summary-card';
import type { RunSummary } from '@/lib/learn/flow/summary';

/**
 * Today's piece at the top of Now (plan #2164.4), worked as a conversation
 * with Dash (plan #2164.5): an idea explained back and marked, the check as
 * the last turn, the finished thread, an answer being marked, one whose
 * marking failed, and a goal with no pieces yet. The thread's words are
 * written by the same functions the server uses.
 */

const SUBJECT_ID = '5e000000-0000-4000-8000-000000000021';
const PIECE_ID = '5d000000-0000-4000-8000-000000000201';
const OPENED_AT = '2026-10-15T08:00:00.000Z';

const ideas: PieceIdea[] = [
  {
    conceptId: '5c000000-0000-4000-8000-000000000101',
    name: 'Net revenue retention, and why it can pass a hundred per cent',
    claim: 'Net revenue retention compares what last year’s customers pay now with what they paid then.',
    dropped: null,
    lesson: {
      takeaway:
        'Net revenue retention above 100% means the customers you already had pay you more this year than last, even after the ones who left.',
      context: 'It is the first number an investor asks a subscription business for, because it says whether growth needs new customers at all.',
      hook: null,
      summary:
        'Take the revenue a year ago from a group of customers, then their revenue today: upgrades and price rises add to it, downgrades and cancellations take away. Divide today by then.',
      example:
        'A team starts the year with customers paying £100,000. Upgrades add £18,000, cancellations take away £9,000 and downgrades £2,000, so the same customers pay £107,000: 107%.',
      question: 'A business loses a fifth of its customers’ revenue to churn but grows the rest by 30%. Is its retention above or below 100%?',
      answer: 'Above: 0.8 × 1.3 is 1.04, so 104%.',
    },
  },
  {
    conceptId: '5c000000-0000-4000-8000-000000000102',
    name: 'Gross revenue retention',
    claim: 'Gross retention counts only what was lost, so it can never pass a hundred per cent.',
    dropped: null,
    lesson: {
      takeaway: 'Gross revenue retention leaves upgrades out, so it shows only how much of last year’s revenue stayed.',
      context: null,
      hook: null,
      summary: 'Start from last year’s revenue, subtract cancellations and downgrades, divide by last year. It tops out at 100%.',
      example: 'The team above keeps £89,000 of its £100,000 before upgrades: gross retention of 89%.',
      question: null,
      answer: null,
    },
  },
  {
    conceptId: '5c000000-0000-4000-8000-000000000103',
    name: 'Cohorts',
    claim: 'A cohort is the customers who started in the same month, followed together over time.',
    dropped: null,
    lesson: {
      takeaway: 'Reading retention by cohort shows whether newer customers stay better or worse than older ones.',
      context: null,
      hook: null,
      summary: 'Group customers by the month they started and plot what each group pays month by month.',
      example: null,
      question: null,
      answer: null,
    },
  },
];

const CHECK = {
  id: '5d000000-0000-4000-8000-000000000401',
  question:
    'A business keeps 92% of last year’s revenue before upgrades, and its net retention is 112%. What do the two numbers together tell you about its customers?',
  expected: 'Few customers leave or downgrade, and those who stay spend noticeably more: upgrades add about 20 points.',
  response: 'Hardly anyone leaves, and the ones who stay pay a lot more, about a fifth more from upgrades.',
  why: 'Right: you read gross retention as what was lost and the gap to net as what upgrades added.',
};

/** A turn of the fixture thread, a minute after the one before. */
function turn(index: number, role: TalkTurn['role'], body: string): TalkTurn {
  return {
    id: `5f000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    role,
    body,
    createdAt: new Date(Date.parse(OPENED_AT) + index * 60_000).toISOString(),
  };
}

const MARKED_FIRST: ExplanationMarking = {
  holds: true,
  right: [
    'Net retention compares the same customers’ revenue now with a year ago.',
    'Upgrades can outweigh what leaves, which is how it passes 100%.',
  ],
  missing: ['Downgrades count against it as well as cancellations.'],
  why: 'Holds: the comparison and the reason it can pass 100% are both there.',
  ownExample: true,
};

const MARKED_FOLLOW: Marking = {
  holds: true,
  right: ['Price rises on the same plan count as expansion.'],
  missing: [],
  why: 'Right.',
};

/** The thread's words, as the server writes them, up to and including `upTo`. */
function thread(upTo: 'follow-up' | 'check' | 'done'): TalkTurn[] {
  const words: [TalkTurn['role'], string][] = [
    ['assistant', explainTurn(ideas[0]!, 0, ideas.length)],
    [
      'user',
      'It is what the customers you had a year ago pay you now, divided by what they paid then. It goes over 100% when the ones who stay upgrade by more than the ones who leave took with them. Say we had £100k, lost £10k to churn but upgrades added £20k: that is 110%.',
    ],
    [
      'assistant',
      explainedTurn(
        MARKED_FIRST,
        'If a business raises its prices by 10% for everyone and nobody leaves, what happens to its net retention, and why?',
      ),
    ],
  ];
  if (upTo !== 'follow-up') {
    words.push(
      ['user', 'It goes to about 110%, because the same customers now pay more and that counts as expansion.'],
      ['assistant', followedUpTurn(MARKED_FOLLOW, ideas[0]!.name, 'sharp')],
      ['assistant', explainTurn(ideas[1]!, 1, ideas.length)],
      [
        'user',
        'Gross retention is only what you kept of last year’s revenue, ignoring upgrades, so it can’t go over 100%. If you lose £11k of £100k it is 89%.',
      ],
      [
        'assistant',
        explainedTurn(
          { ...MARKED_FIRST, right: ['Leaves upgrades out, so it tops out at 100%.'], missing: [] },
          'Why would an investor want both numbers rather than net retention alone?',
        ),
      ],
      ['user', 'Net can hide heavy churn if a few big customers upgrade a lot; gross shows the leak on its own.'],
      [
        'assistant',
        followedUpTurn(
          { holds: true, right: ['Net can hide churn that gross shows on its own.'], missing: [], why: 'Right.' },
          ideas[1]!.name,
          'sharp',
        ),
      ],
      ['assistant', explainTurn(ideas[2]!, 2, ideas.length)],
      [
        'user',
        'A cohort is everyone who started in the same month, and you follow what that group pays over time, so you can tell if newer customers stay better than older ones.',
      ],
      [
        'assistant',
        explainedTurn(
          { ...MARKED_FIRST, right: ['Groups customers by start month and follows them.'], missing: [], ownExample: false },
          'What would it tell you if each new cohort’s revenue curve sat above the last?',
        ),
      ],
      ['user', 'That newer customers stay and expand more than older ones did, so the product or the fit is getting better.'],
      [
        'assistant',
        followedUpTurn(
          {
            holds: true,
            right: ['Newer cohorts sitting higher means customers are staying and expanding more.'],
            missing: ['That it could also be a price rise rather than better fit.'],
            why: 'Holds.',
          },
          ideas[2]!.name,
          'known',
        ),
      ],
      ['assistant', checkTurn(CHECK.question)],
    );
  }
  if (upTo === 'done') {
    words.push(
      ['user', CHECK.response],
      ['assistant', checkedTurn({ correct: true, why: CHECK.why, expected: CHECK.expected }, null)],
    );
  }
  return words.map(([role, body], index) => turn(index, role, body));
}

/** What moved in this session: the piece's three ideas, in the person's own words from the thread. */
const PIECE_SUMMARY: RunSummary = {
  answers: 7,
  shown: [
    {
      name: ideas[0]!.name,
      quote: 'It goes over 100% when the ones who stay upgrade by more than the ones who leave took with them.',
    },
    { name: ideas[1]!.name, quote: 'Net can hide heavy churn if a few big customers upgrade a lot.' },
    { name: ideas[2]!.name, quote: 'Newer customers stay and expand more than older ones did.' },
  ],
  missed: [],
  fringe: ['Expansion revenue', 'Logo churn'],
  more: { shown: 0, missed: 0, fringe: 0 },
};

function piece(over: { turns?: TalkTurn[]; state?: PieceTalkState | null } = {}): TodaysPiece {
  return {
    kind: 'piece',
    goalName: 'SaaS and subscription business metrics',
    page: {
      piece: { id: PIECE_ID, ordinal: 3, title: 'Retention: who stays and what they pay', passedAt: null },
      subject: { id: SUBJECT_ID, name: 'SaaS and subscription business metrics' },
      unit: { id: '5d000000-0000-4000-8000-000000000301', ordinal: 2, title: 'Keeping customers', outcome: null },
      siblings: [],
      ideas,
      cells: [],
      check: null,
    },
    talk: { turns: over.turns ?? [], state: over.state ?? null, openedAt: OPENED_AT },
  };
}

const RUN = {
  lowMicros: 2_000,
  medianMicros: 4_000,
  highMicros: 9_000,
  runs: 14,
  basis: 'measured',
  per: 'run',
  models: [MODELS.learnProbe],
} as const;

function Costs({ children }: { children: ReactNode }) {
  return (
    <PaidCostsProvider costs={{ 'app/learn/now/piece-talk-actions.ts#talkPiece': RUN }}>{children}</PaidCostsProvider>
  );
}

/** The first idea explained back and marked, with its follow-up waiting. */
export function TodaysPieceSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece({
          turns: thread('follow-up'),
          state: {
            stage: 'follow_up',
            conceptId: ideas[0]!.conceptId,
            probeId: '5d000000-0000-4000-8000-000000000501',
            followUpId: '5d000000-0000-4000-8000-000000000502',
          },
        })}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** Every idea worked through: the check is the last turn. */
export function TodaysPieceCheckSurface() {
  return (
    <Costs>
      <PieceFirst piece={piece({ turns: thread('check'), state: { stage: 'check', checkId: CHECK.id } })}>
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** The check answered right: the thread closes and what moved shows under it. */
export function TodaysPieceDoneSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece({ turns: thread('done'), state: { stage: 'done' } })}
        summary={<SummaryView summary={PIECE_SUMMARY} />}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

const FIRST_ANSWER =
  'It is what the customers you had a year ago pay you now, divided by what they paid then, so upgrades can take it past 100%.';

/** The first answer sent, while Dash reads and marks it. */
export function TodaysPieceLoadingSurface() {
  return (
    <Costs>
      <PieceFirst piece={piece()} sent={{ body: FIRST_ANSWER }}>
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** The first answer kept, and marking it failed. */
export function TodaysPieceErrorSurface() {
  return (
    <Costs>
      <PieceFirst
        piece={piece()}
        sent={{ body: FIRST_ANSWER, error: 'Marking failed: Dash did not answer in time. Your answer is kept; send it again.' }}
      >
        {null}
      </PieceFirst>
    </Costs>
  );
}

/** A goal with no pieces written yet, above the cards. */
export function TodaysPieceNoneSurface({ cards }: { cards: ReactNode }) {
  return (
    <PieceFirst piece={{ kind: 'no-pieces', goalName: 'Financial modeling in Excel for operators', subjectId: SUBJECT_ID }}>
      {cards}
    </PieceFirst>
  );
}
