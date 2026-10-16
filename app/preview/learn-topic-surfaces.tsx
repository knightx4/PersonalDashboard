'use client';

import { TopicsView } from '@/app/learn/topics/topics-view';
import { TopicView } from '@/app/learn/topics/[id]/topic-view';
import { kindAndCeiling } from '@/lib/learn/evidence/kinds';
import type { EvidenceLink } from '@/lib/learn/evidence/model';
import { TopicSkeleton } from '@/app/learn/topics/[id]/topic-skeleton';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS } from '@/lib/core/models';
import type { DevComment } from '@/lib/comments/load';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { CellEvidence, CellLink, LevelCell, TopicMap } from '@/lib/learn/levels/model';
import { topicStanding } from '@/lib/learn/levels/standing';
import type { CellEvidenceView } from '@/lib/learn/levels/store-page';
import type { DraftingRecord } from '@/lib/learn/levels/draft-sources';
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
    scope:
      'Valuing a company as the discounted sum of its future free cash flows, with a terminal value; multiples are a neighbour.',
    status: 'draft',
    ceiling: 10,
    asked: 'How do you value a company from its cash flows?',
    createdAt: '2026-10-15T09:10:00Z',
    approvedAt: null,
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Capital asset pricing model',
    scope:
      'Expected return from beta, the risk-free rate and the market premium; multi-factor models are a neighbour.',
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
    scope:
      'Why adding a road to a network can slow every driver down, at the equilibrium selfish routing reaches.',
    status: 'approved',
    ceiling: 7,
    asked: null,
    createdAt: '2026-10-02T19:00:00Z',
    approvedAt: '2026-10-02T19:12:00Z',
  },
];

const COMMENTS = new Map<string, number>([[DCF_ID, 2]]);

/* What drafting a topic costs, as the learn layout provides it, so the $
 * beside Draft the topic is drawn (law 16): two Sonnet calls and an embedding. */
const DRAFT_COST: CostEstimate = {
  lowMicros: 120_000,
  medianMicros: 180_000,
  highMicros: 260_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [MODELS.learnTopicDraft, 'voyage-4-lite'],
};

function Priced({ children }: { children: React.ReactNode }) {
  return (
    <PaidCostsProvider costs={{ 'app/learn/topics/actions.ts#draftTopicFromGoal': DRAFT_COST }}>
      {children}
    </PaidCostsProvider>
  );
}

export function LearnTopicsPreview() {
  return (
    <TopicsView
      topics={TOPICS}
      move={{ toMove: 9, toAnswer: 3 }}
      comments={COMMENTS}
      timezone={ZONE}
      now={NOW}
    />
  );
}

export function LearnTopicsLoadingPreview() {
  return (
    <Priced>
      <TopicsView
        topics={TOPICS.slice(1)}
        comments={new Map()}
        timezone={ZONE}
        now={NOW}
        form={{ pending: true, goal: 'How do you value a company from its cash flows?' }}
      />
    </Priced>
  );
}

export function LearnTopicsErrorPreview() {
  return (
    <Priced>
      <TopicsView
        topics={TOPICS.slice(1)}
        comments={new Map()}
        timezone={ZONE}
        now={NOW}
        form={{
          error:
            'Dash could not write the draft. Request timed out. Press Draft the topic to send it again.',
          goal: 'How do you value a company from its cash flows?',
        }}
      />
    </Priced>
  );
}

/* What the draft was compiled from (plan #2138.11): a syllabus, a textbook's
 * contents and the requirement lines of the roles pursued, with three
 * performances. The longest label is the roles' one. */
const SYLLABUS = 'CFA Level I, Equity valuation: free cash flow models';
const TEXTBOOK = 'Damodaran, Investment Valuation (3rd ed.), contents';
const ROLES = 'Requirement lines of 7 roles you pursued matching “FP&A”';

const DRAFTING: DraftingRecord = {
  sources: [
    {
      id: 'S1',
      label: SYLLABUS,
      items: [
        'Compare the free cash flow approach with dividend discount models',
        'Calculate FCFF and FCFE from net income, EBIT and cash flow from operations',
        'Explain the single-stage and two-stage free cash flow models',
        'Calculate a terminal value with the Gordon growth model',
        'Describe how sensitivity analysis is used in valuation',
        'Explain the use of multiples as a cross-check',
      ],
    },
    {
      id: 'S2',
      label: TEXTBOOK,
      items: [
        'Estimating discount rates',
        'Estimating cash flows',
        'Estimating growth',
        'Closure in valuation: estimating terminal value',
        'Valuing firms with negative earnings',
        'Valuing financial service firms',
        'Real options',
      ],
    },
    {
      id: 'S3',
      label: ROLES,
      items: [
        'Build and maintain three-statement financial models',
        'Experience with DCF and comparable company analysis',
        'Present valuation outcomes to leadership',
      ],
    },
  ],
  performances: [
    'Value a listed company from its 10-K and defend the result',
    'Read a sell-side DCF and find the assumption that drives it',
    'Explain to a manager why the valuation moved',
  ],
  coverage: {
    share: 13 / 15,
    sources: [
      { id: 'S1', label: SYLLABUS, covered: 6, inScope: 6, total: 6 },
      { id: 'S2', label: TEXTBOOK, covered: 5, inScope: 6, total: 7 },
      { id: 'S3', label: ROLES, covered: 2, inScope: 3, total: 3 },
    ],
    uncovered: ['S2.7 Real options', 'S3.1 Build and maintain three-statement financial models'],
  },
  structure: {
    acyclic: true,
    offPath: [10],
    served: [
      { performance: 'Value a listed company from its 10-K and defend the result', level: 5 },
      { performance: 'Read a sell-side DCF and find the assumption that drives it', level: 6 },
      { performance: 'Explain to a manager why the valuation moved', level: 9 },
    ],
    unserved: [],
  },
  overlap: 0.64,
  overlapMissing: null,
  checklist: [
    'Does level 9 include the reverse DCF analysts use to read what a price implies?',
    'Does level 8 tie the discount rate to WACC rather than restating CAPM?',
    'Would a practitioner expect stock-based compensation at level 9 or earlier?',
  ],
};

const CELL_SOURCES: (string | null)[] = [
  `${SYLLABUS}: Compare the free cash flow approach with dividend discount models`,
  `${TEXTBOOK}: Estimating cash flows`,
  `${SYLLABUS}: Calculate FCFF and FCFE from net income, EBIT and cash flow from operations`,
  `${SYLLABUS}: Calculate a terminal value with the Gordon growth model`,
  `${ROLES}: Experience with DCF and comparable company analysis`,
  `${SYLLABUS}: Describe how sensitivity analysis is used in valuation`,
  `${TEXTBOOK}: Valuing firms with negative earnings; ${TEXTBOOK}: Valuing financial service firms`,
  `${TEXTBOOK}: Estimating discount rates`,
  null,
  `${TEXTBOOK}: Closure in valuation: estimating terminal value`,
];

const DCF: TopicDetail = {
  ...TOPICS[0],
  citation: { source: `${SYLLABUS}; ${TEXTBOOK}`, canonicality: 'canonical' },
  drafting: DRAFTING,
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
    source: CELL_SOURCES[i],
    canonicality: CELL_SOURCES[i] === null ? null : i === 4 ? 'practitioner' : 'canonical',
  })),
  links: [
    {
      id: 'l-1',
      fromLevel: 2,
      topicId: TOPICS[2].id,
      topicName: 'Return',
      level: 2,
      why: 'Discounting is a required return run backwards.',
      source: `${TEXTBOOK}: Estimating discount rates`,
      canonicality: 'canonical',
    },
    {
      id: 'l-2',
      fromLevel: 3,
      topicId: TOPICS[1].id,
      topicName: 'Capital asset pricing model',
      level: 2,
      why: 'The cost of equity in the discount rate comes from it.',
      source: null,
      canonicality: null,
    },
  ],
  wanted: [
    {
      name: 'Weighted average cost of capital',
      scope:
        'The blended rate a company pays its lenders and shareholders, weighted by how it is financed.',
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
  return (
    <TopicView topic={DCF} match={MATCH} comments={[]} path={PATH} timezone={ZONE} now={NOW} />
  );
}

/* Every row cited or marked personal, so Approve is open; this draft's
 * second call failed, so stability has nothing to compare. */
const DCF_SETTLED: TopicDetail = {
  ...DCF,
  drafting: {
    ...DRAFTING,
    overlap: null,
    overlapMissing: 'The second draft failed (Request timed out), so there is nothing to compare.',
  },
  cells: DCF.cells.map((cell) => (cell.source ? cell : { ...cell, canonicality: 'personal' })),
  links: DCF.links.map((link) => (link.source ? link : { ...link, canonicality: 'personal' })),
};

export function LearnTopicDraftChecksPreview() {
  return (
    <TopicView
      topic={DCF_SETTLED}
      match={null}
      comments={[]}
      path={PATH}
      timezone={ZONE}
      now={NOW}
    />
  );
}

export function LearnTopicsSourcesPreview() {
  return (
    <Priced>
      <TopicsView
        topics={TOPICS.slice(1)}
        comments={new Map()}
        timezone={ZONE}
        now={NOW}
        form={{
          goal: 'How do you value a company from its cash flows?',
          sources: {
            performances: DRAFTING.performances.join('\n'),
            sources: [
              [SYLLABUS, ...DRAFTING.sources[0].items.slice(0, 4)].join('\n'),
              [TEXTBOOK, ...DRAFTING.sources[1].items.slice(0, 3)].join('\n'),
            ].join('\n\n'),
            roles: 'FP&A',
          },
        }}
      />
    </Priced>
  );
}

export function LearnTopicDraftCommentPreview() {
  return (
    <TopicView topic={DCF} match={null} comments={THREAD} path={PATH} timezone={ZONE} now={NOW} />
  );
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
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `r-${i + 1}`,
      topicId: RETURN_ID,
      level: i + 1,
    })),
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
    quote:
      'It is the future cash the business will throw off, each year shrunk back to today by the rate you could earn elsewhere.',
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
  const model: CellEvidence[] = evidence.map((e) => ({
    cellId: e.cellId,
    verdict: e.verdict,
    observedAt: e.observedAt,
  }));
  return topicStanding(topic, mapOf(topic, model), evidence, linksIn);
}

/* What backs the frame topic DCF refines (plan #2172.2): a mark of each
 * kind, each with the most it can count for. The course was named for the
 * topic, so it carries a band of likely levels and its reason (plan
 * #2172.4.1). */
const BACKING: EvidenceLink[] = (
  [
    ['work', 1, 0.66, 'From your résumé: "Built the three-statement model for a 40 million dollar carve-out and took the client CFO through its sensitivities"'],
    ['course', 1, 0.8, 'from MGT 541 Corporate Finance, HH, 2026: an advanced course reaches level 4 at most, and the grade keeps 4.'],
    ['note', 1, 0.62, 'named in your note Corporate Finance week 6: WACC, the cost of capital and why the terminal year carries the valuation'],
    ['note', 0.25, 0.58, 'close to your note Valuation clippings'],
  ] as const
).map(([source, weight, similarity, basis], i) => ({
  id: `b-${i}`,
  targetKind: 'topic' as const,
  targetId: 'frame-dcf',
  sourceKind: source,
  sourceId: `s-${i}`,
  similarity,
  ...kindAndCeiling({ source_kind: source, weight }),
  basis,
  foundAt: '2026-10-14T06:00:00Z',
  matchedBy: source === 'course' ? null : ('name' as const),
  band: source === 'course' ? { low: 1, high: 4 } : null,
}));

function ApprovedTopic({
  evidence,
  open,
}: {
  evidence: CellEvidenceView[];
  open?: { quotes?: number; edit?: number; backing?: boolean };
}) {
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
      backing={evidence.length > 0 ? BACKING : []}
      open={open}
    />
  );
}

export function LearnTopicPreview() {
  return <ApprovedTopic evidence={EVIDENCE} open={{ backing: true }} />;
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
