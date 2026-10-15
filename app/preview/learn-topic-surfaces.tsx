'use client';

import { TopicsView } from '@/app/learn/topics/topics-view';
import { TopicView } from '@/app/learn/topics/[id]/topic-view';
import type { DevComment } from '@/lib/comments/load';
import type { TopicDetail, TopicMatch, TopicRow } from '@/lib/learn/levels/store';

/**
 * Learn's topics (plan #2138.2): the list with a goal being named, and a
 * draft topic's approval screen, with each hidden part the step lists drawn
 * on its own surface: the duplicate beside the draft, the loading while the
 * draft is written, the error when the call fails, and a comment on the
 * draft.
 */

const NOW = new Date('2026-10-15T09:30:00Z').getTime();
const ZONE = 'Europe/London';

const DCF_ID = 'a0000000-0000-4000-8000-000000000001';

const TOPICS: TopicRow[] = [
  {
    id: DCF_ID,
    name: 'Discounted cash flow',
    scope: 'Valuing a company as the discounted sum of its future free cash flows, with a terminal value; multiples are a neighbour.',
    status: 'draft',
    ceiling: 10,
    asked: 'How do you value a company from its cash flows?',
    createdAt: '2026-10-15T09:10:00Z',
    approvedAt: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Capital asset pricing model',
    scope: 'Expected return from beta, the risk-free rate and the market premium; multi-factor models are a neighbour.',
    status: 'approved',
    ceiling: 8,
    asked: 'CAPM',
    createdAt: '2026-10-12T14:00:00Z',
    approvedAt: '2026-10-12T14:20:00Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    name: 'Return',
    scope: 'What a return on an investment is, simple and compound, arithmetic and geometric.',
    status: 'approved',
    ceiling: 6,
    asked: null,
    createdAt: '2026-10-10T08:00:00Z',
    approvedAt: '2026-10-10T08:05:00Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    name: "Braess's paradox",
    scope: 'Why adding a road to a network can slow every driver down, at the equilibrium selfish routing reaches.',
    status: 'approved',
    ceiling: 7,
    asked: null,
    createdAt: '2026-10-02T19:00:00Z',
    approvedAt: '2026-10-02T19:12:00Z',
  },
];

const COMMENTS = new Map<string, number>([[DCF_ID, 2]]);

export function LearnTopicsPreview() {
  return <TopicsView topics={TOPICS} move={{ toMove: 9, toAnswer: 3 }} comments={COMMENTS} timezone={ZONE} now={NOW} />;
}

export function LearnTopicsLoadingPreview() {
  return (
    <TopicsView
      topics={TOPICS.slice(1)}
      comments={new Map()}
      timezone={ZONE}
      now={NOW}
      form={{ pending: true, goal: 'How do you value a company from its cash flows?' }}
    />
  );
}

export function LearnTopicsErrorPreview() {
  return (
    <TopicsView
      topics={TOPICS.slice(1)}
      comments={new Map()}
      timezone={ZONE}
      now={NOW}
      form={{
        error: 'Dash could not write the draft. Request timed out. Press Draft the topic to send it again.',
        goal: 'How do you value a company from its cash flows?',
      }}
    />
  );
}

const DCF: TopicDetail = {
  ...TOPICS[0],
  fieldNames: ['Finance', 'Accounting'],
  cells: [
    [
      'Can say it values a company from the cash it will produce',
      'Can name one situation where it is the usual method, such as an acquisition',
    ],
    [
      'Can define it as the sum of future free cash flows discounted to today',
      'Can say why money later is worth less than money now',
    ],
    [
      'Can explain why free cash flow is used rather than net income',
      'Can say what the discount rate stands for and where it comes from',
      'Can say what the terminal value stands for',
    ],
    [
      'Can build one from given projections and a given discount rate',
      'Can compute a terminal value with the Gordon growth formula',
    ],
    [
      'Can value a listed company from its filings, choosing the projections',
      'Can justify the growth and discount rates chosen',
    ],
    [
      'Can read a sensitivity table and say which input drives the value',
      'Can cross-check the result against trading multiples',
    ],
    [
      'Can say why a terminal value above 70% of the total is a warning',
      'Can name the cases it handles badly, such as negative cash flow',
      'Can say what to use instead for a bank',
    ],
    [
      'Can show a multiple as a DCF with the assumptions folded in',
      'Can relate the discount rate to WACC and CAPM',
    ],
    [
      'Can run a reverse DCF to find the growth the price implies',
      'Can say how practitioners handle mid-year discounting and stock compensation',
    ],
    [
      'Can argue whether a DCF means anything for an early-stage company',
      'Can answer the objection that small input changes swing the value',
    ],
  ].map((checks, i) => ({
    id: `c-${i + 1}`,
    level: i + 1,
    checks,
    original: null,
    rewrittenAt: null,
  })),
  links: [
    {
      fromLevel: 2,
      topicId: TOPICS[2].id,
      topicName: 'Return',
      level: 2,
      why: 'Discounting is a required return run backwards.',
    },
    {
      fromLevel: 3,
      topicId: TOPICS[1].id,
      topicName: 'Capital asset pricing model',
      level: 2,
      why: 'The cost of equity in the discount rate comes from it.',
    },
  ],
  wanted: [
    {
      name: 'Weighted average cost of capital',
      scope: 'The blended rate a company pays its lenders and shareholders, weighted by how it is financed.',
      from_level: 3,
      level: 2,
      why: 'The discount rate for a whole company is its WACC.',
    },
  ],
};

const MATCH: TopicMatch = {
  id: 'a0000000-0000-4000-8000-000000000009',
  name: 'DCF valuation',
  scope: 'Valuing a business by discounting the cash flows it is expected to produce.',
  status: 'approved',
  ceiling: 9,
  similarity: 0.91,
};

const PATH = {
  ref: `learn.topics:${DCF_ID}`,
  path: [
    { label: 'Learn', href: '/learn' },
    { label: 'Topics', href: '/learn/topics' },
    { label: 'Discounted cash flow', href: `/learn/topics/${DCF_ID}` },
  ],
};

const THREAD: DevComment[] = [
  {
    id: 'm1',
    author: 'me',
    body: 'Level 9 should mention the equity bridge, net debt to equity value.',
    createdAt: '2026-10-15T09:20:00Z',
  },
  {
    id: 'm2',
    author: 'claude',
    body: 'Added to level 9 would read: "Can walk from enterprise value to equity value through net debt." Reword it there and approve.',
    createdAt: '2026-10-15T09:21:00Z',
  },
];

export function LearnTopicDraftPreview() {
  return <TopicView topic={DCF} match={null} comments={[]} path={PATH} timezone={ZONE} now={NOW} />;
}

export function LearnTopicDraftMatchPreview() {
  return <TopicView topic={DCF} match={MATCH} comments={[]} path={PATH} timezone={ZONE} now={NOW} />;
}

export function LearnTopicDraftCommentPreview() {
  return <TopicView topic={DCF} match={null} comments={THREAD} path={PATH} timezone={ZONE} now={NOW} />;
}
