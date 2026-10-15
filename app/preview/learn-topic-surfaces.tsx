'use client';

import { TopicsView } from '@/app/learn/topics/topics-view';
import { TopicView } from '@/app/learn/topics/[id]/topic-view';
import { TopicSkeleton } from '@/app/learn/topics/[id]/topic-skeleton';
import type { DevComment } from '@/lib/comments/load';
import type { CellEvidence, CellLink, LevelCell, TopicMap } from '@/lib/learn/levels/model';
import { topicStanding } from '@/lib/learn/levels/standing';
import type { CellEvidenceView } from '@/lib/learn/levels/store-page';
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
  return <TopicsView topics={TOPICS} comments={COMMENTS} timezone={ZONE} now={NOW} />;
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

/* The approved topic's ladder (plan #2138.3). The same Discounted cash flow
 * topic, approved, with answers behind some of its levels: levels 1 and 2 are
 * shown, 3 is declared, 4 is met in a quote, 5 was missed, and level 2 was
 * reworded after it was shown. Statuses come from the real model, not from
 * fixtures of its output. */

const APPROVED: TopicDetail = {
  ...DCF,
  status: 'approved',
  approvedAt: '2026-10-15T09:30:00Z',
  cells: DCF.cells.map((cell) =>
    cell.level === 2
      ? {
          ...cell,
          checks: [
            'Can define it as the sum of future free cash flows discounted to today',
            'Can say why a dollar later is worth less than a dollar now, and what sets the gap',
          ],
          original: cell.checks,
          rewrittenAt: '2026-10-14T18:00:00Z',
        }
      : cell,
  ),
  wanted: [],
};

const RETURN_ID = TOPICS[2].id;
const CAPM_ID = TOPICS[1].id;

function mapOf(topic: TopicDetail, evidence: CellEvidence[]): TopicMap {
  const cells: LevelCell[] = [
    ...topic.cells.map((c) => ({ id: c.id, topicId: DCF_ID, level: c.level })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `r-${i + 1}`, topicId: RETURN_ID, level: i + 1 })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `p-${i + 1}`, topicId: CAPM_ID, level: i + 1 })),
  ];
  const links: CellLink[] = [
    { requiringCellId: 'c-2', requiredCellId: 'r-2' },
    { requiringCellId: 'c-3', requiredCellId: 'p-2' },
  ];
  return {
    topics: [
      { id: DCF_ID, name: topic.name, ceiling: 10, approved: true },
      { id: RETURN_ID, name: 'Return', ceiling: 6, approved: true },
      { id: CAPM_ID, name: 'Capital asset pricing model', ceiling: 8, approved: true },
    ],
    cells,
    links,
    evidence,
  };
}

const EVIDENCE: CellEvidenceView[] = [
  { cellId: 'c-5', verdict: 'not_met', quote: null, observedAt: '2026-10-15T08:40:00Z' },
  {
    cellId: 'c-4',
    verdict: 'met',
    quote:
      'I would take the projected free cash flow for each of the five years, divide each by one plus the discount rate to the power of the year, and add the Gordon growth terminal value discounted from year five.',
    observedAt: '2026-10-15T08:35:00Z',
  },
  { cellId: 'c-3', verdict: 'declared', quote: null, observedAt: '2026-10-13T12:00:00Z' },
  {
    cellId: 'c-2',
    verdict: 'met',
    quote: 'It is the future cash the business will throw off, each year shrunk back to today by the rate you could earn elsewhere.',
    observedAt: '2026-10-12T19:00:00Z',
  },
];

const LINKS_IN = [
  {
    level: 3,
    topicId: 'a0000000-0000-4000-8000-000000000011',
    topicName: 'Enterprise value',
    fromLevel: 4,
    why: 'Bridging from a DCF to equity value starts from the enterprise value it gives.',
  },
];

function standingOf(topic: TopicDetail, evidence: CellEvidenceView[], linksIn: typeof LINKS_IN) {
  const model: CellEvidence[] = evidence.map((e) => ({ cellId: e.cellId, verdict: e.verdict, observedAt: e.observedAt }));
  return topicStanding(topic, mapOf(topic, model), evidence, linksIn);
}

function ApprovedTopic({ evidence, open }: { evidence: CellEvidenceView[]; open?: { quotes?: number; edit?: number } }) {
  // With nothing asked yet no level has been reworded either.
  const topic = evidence.length > 0 ? APPROVED : { ...APPROVED, cells: DCF.cells };
  return (
    <TopicView
      topic={topic}
      match={null}
      comments={[]}
      path={PATH}
      timezone={ZONE}
      now={NOW}
      standing={standingOf(topic, evidence, evidence.length > 0 ? LINKS_IN : [])}
      open={open}
    />
  );
}

export function LearnTopicPreview() {
  return <ApprovedTopic evidence={EVIDENCE} />;
}

export function LearnTopicEmptyPreview() {
  return <ApprovedTopic evidence={[]} />;
}

export function LearnTopicQuotesPreview() {
  return <ApprovedTopic evidence={EVIDENCE} open={{ quotes: 4 }} />;
}

export function LearnTopicEditPreview() {
  return <ApprovedTopic evidence={EVIDENCE} open={{ edit: 4 }} />;
}

export function LearnTopicLoadingPreview() {
  return <TopicSkeleton />;
}
