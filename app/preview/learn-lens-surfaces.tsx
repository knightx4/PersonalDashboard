'use client';

import { LensView } from '@/app/learn/lens/[id]/lens-view';
import { LensSkeleton } from '@/app/learn/lens/[id]/lens-skeleton';
import { FieldLevels, SubjectLenses, type SubjectLensRow } from '@/app/learn/know/lens-lists';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { RouteError } from '@/components/ui/route-error';
import type { DevComment } from '@/lib/comments/load';
import { zoneDay } from '@/lib/core/when';
import {
  fieldLevels,
  lensDetail,
  summariseLens,
  type LensRecord,
  type TopicName,
} from '@/lib/learn/levels/lenses';
import type { LensSource } from '@/lib/learn/levels/lens-store';
import { readCells, type CellEvidence, type CellLink, type LevelTopic, type TopicMap } from '@/lib/learn/levels/model';

/**
 * Lenses (plan #2138.7): a subject or learning goal as topics to targets, and
 * the Know page's lenses and fields. Each hidden part the step lists has its
 * own surface: the fringe open on one topic, the target editor, a lens with
 * no answers, one with no topics, loading and the error. The comment
 * indicator is on the Know page's rows.
 *
 * The fixtures go through the real model, so the bars, bands and fringe are
 * what the page would compute from this map.
 */

const NOW = new Date('2026-10-15T09:30:00Z').getTime();
const ZONE = 'Europe/London';
const DAY = { today: zoneDay(NOW, ZONE), dayOf: (at: string) => zoneDay(at, ZONE) };

const LENS_ID = 'b0000000-0000-4000-8000-000000000001';

const TOPICS: LevelTopic[] = [
  { id: 't-dcf', name: 'Discounted cash flow', ceiling: 10, approved: true },
  { id: 't-wacc', name: 'Weighted average cost of capital', ceiling: 8, approved: true },
  { id: 't-return', name: 'Return', ceiling: 6, approved: true },
  { id: 't-capm', name: 'Capital asset pricing model', ceiling: 8, approved: true },
  { id: 't-beta', name: 'Beta', ceiling: 6, approved: true },
  { id: 't-multiples', name: 'Valuation multiples and the comparable-company method', ceiling: 7, approved: false },
];

const LINKS: CellLink[] = [
  { requiringCellId: 't-capm3', requiredCellId: 't-beta2' },
  { requiringCellId: 't-wacc3', requiredCellId: 't-capm3' },
  { requiringCellId: 't-dcf5', requiredCellId: 't-wacc4' },
];

function ev(cellId: string, verdict: CellEvidence['verdict'], observedAt: string): CellEvidence {
  return { cellId, verdict, observedAt };
}

const EVIDENCE: CellEvidence[] = [
  ev('t-dcf4', 'met', '2026-10-10T10:00:00Z'),
  ev('t-return4', 'met', '2026-10-08T10:00:00Z'),
  ev('t-capm2', 'met', '2026-10-09T10:00:00Z'),
  ev('t-beta2', 'met', '2026-10-09T10:05:00Z'),
  ev('t-capm3', 'not_met', '2026-10-11T10:00:00Z'),
  ev('t-wacc1', 'declared', '2026-10-12T10:00:00Z'),
];

function mapWith(evidence: CellEvidence[]): TopicMap {
  return {
    topics: TOPICS,
    cells: TOPICS.flatMap((t) =>
      Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
    ),
    links: LINKS,
    evidence,
  };
}

const NAMES = new Map<string, TopicName>(
  TOPICS.map((t) => [t.id, { id: t.id, name: t.name, approved: t.approved, ceiling: t.ceiling }]),
);

const LENS: LensRecord = {
  id: LENS_ID,
  name: 'Corporate finance',
  origin: 'subject',
  subjectId: 's-corp',
  aimId: null,
  createdAt: '2026-10-02T09:00:00Z',
  targets: [
    { topicId: 't-dcf', targetLevel: 7, addedAt: '2026-10-02T09:00:00Z' },
    { topicId: 't-wacc', targetLevel: 6, addedAt: '2026-10-02T09:00:00Z' },
    { topicId: 't-return', targetLevel: 4, addedAt: '2026-10-02T09:00:00Z' },
    { topicId: 't-capm', targetLevel: 6, addedAt: '2026-10-02T09:00:00Z' },
    { topicId: 't-beta', targetLevel: 5, addedAt: '2026-10-15T08:40:00Z' },
    { topicId: 't-multiples', targetLevel: 5, addedAt: '2026-10-15T08:45:00Z' },
  ],
};

const SOURCE: LensSource = { kind: 'subject', subjectId: 's-corp', name: 'Corporate finance' };

const PATH = {
  ref: `learn.lenses:${LENS_ID}`,
  path: [
    { label: 'Learn', href: '/learn' },
    { label: 'Subjects', href: '/learn/know' },
    { label: 'Corporate finance', href: `/learn/lens/${LENS_ID}` },
  ],
};

const THREAD: DevComment[] = [
  {
    id: 'l1',
    author: 'me',
    body: 'WACC to 6 is more than I need for the FP&A role. 5 is enough.',
    createdAt: '2026-10-15T09:10:00Z',
  },
];

function detailFor(lens: LensRecord, evidence: CellEvidence[]) {
  const map = mapWith(evidence);
  return lensDetail(lens, map, readCells(map), NAMES, DAY);
}

function Lens({
  lens = LENS,
  evidence = EVIDENCE,
  source = SOURCE,
  comments = THREAD,
  editing = false,
  fringe,
}: {
  lens?: LensRecord;
  evidence?: CellEvidence[];
  source?: LensSource;
  comments?: DevComment[];
  editing?: boolean;
  fringe?: string;
}) {
  return (
    <LensView
      id={lens.id}
      name={lens.name}
      source={source}
      createdAt={lens.createdAt}
      detail={detailFor(lens, evidence)}
      comments={comments}
      path={{ ...PATH, path: [...PATH.path.slice(0, 2), { label: lens.name, href: `/learn/lens/${lens.id}` }] }}
      editing={editing}
      open={fringe ? { fringe } : undefined}
      timezone={ZONE}
      now={NOW}
    />
  );
}

export function LearnLensPreview() {
  return <Lens />;
}

export function LearnLensFringePreview() {
  return <Lens fringe="t-capm" />;
}

export function LearnLensEditPreview() {
  return <Lens editing />;
}

/** A goal's lens with its topics and no answers yet. */
export function LearnLensUntouchedPreview() {
  const goal: LensRecord = {
    ...LENS,
    id: 'b0000000-0000-4000-8000-000000000002',
    name: 'Solid on startup FP&A',
    origin: 'goal',
    subjectId: null,
    aimId: 'aim-fpa',
    targets: LENS.targets.slice(0, 4).map((t) => ({ ...t, targetLevel: Math.min(t.targetLevel, 5) })),
  };
  return (
    <Lens lens={goal} evidence={[]} comments={[]} source={{ kind: 'goal', goalId: 'g-fpa', depth: 'solid', archived: false }} />
  );
}

/** A subject's lens before any topic is on it. */
export function LearnLensEmptyPreview() {
  const lens: LensRecord = { ...LENS, name: 'Urban economics and the economics of housing supply', targets: [] };
  return <Lens lens={lens} evidence={[]} comments={[]} />;
}

export function LearnLensLoadingPreview() {
  return <LensSkeleton />;
}

export function LearnLensErrorPreview() {
  return (
    <RouteError
      what="this lens"
      error={Object.assign(new Error('Reading the lens failed'), { digest: 'preview' })}
      reset={() => {}}
      backHref="/learn/know"
      backLabel="Back to Subjects"
    />
  );
}

/* The Know page's lenses and fields. */

const MAP = mapWith(EVIDENCE);
const READINGS = readCells(MAP);
const SUMMARY = summariseLens(LENS, MAP, READINGS, NAMES);

const SUBJECT_ROWS: SubjectLensRow[] = [
  { subjectId: 's-corp', name: 'Corporate finance', note: null, lens: SUMMARY, graphLine: '', comments: 1, goals: ['Solid on startup FP&A'] },
  {
    subjectId: 's-housing',
    name: 'Urban economics and the economics of housing supply',
    note: 'Why rents rose faster than wages in every city I have lived in',
    lens: { ...SUMMARY, id: 'l-housing', name: 'Urban economics', topics: 0, drafts: 0, held: 0, total: 0, fraction: 0 },
    graphLine: '4 of 19 known · 3 getting there · 1 mixed up',
    comments: 0,
    goals: ['Understand why housing supply lags demand in growing cities', 'Familiar with zoning and land-use economics'],
  },
  {
    subjectId: 's-stats',
    name: 'Statistics',
    note: null,
    lens: { ...SUMMARY, id: 'l-stats', name: 'Statistics', topics: 0, drafts: 1, held: 0, total: 0, fraction: 0 },
    graphLine: 'No concepts yet.',
    comments: 0,
    goals: [],
  },
];


const FIELD_TAGS = new Map<string, string[]>([
  ['t-dcf', ['f-fin']],
  ['t-wacc', ['f-fin']],
  ['t-capm', ['f-fin', 'f-econ']],
  ['t-return', ['f-fin', 'f-stats']],
  ['t-beta', ['f-stats']],
]);
const FIELDS = [
  { id: 'f-fin', name: 'Finance' },
  { id: 'f-econ', name: 'Economics' },
  { id: 'f-stats', name: 'Statistics and probability' },
  { id: 'f-hist', name: 'History' },
];

function KnowLenses({ empty = false }: { empty?: boolean }) {
  return (
    <PageColumn>
      <PageHeader subject={{ ref: null, path: [{ label: 'Learn', href: '/learn' }] }} title="Subjects" />
      <SubjectLenses rows={empty ? SUBJECT_ROWS.slice(1, 2) : SUBJECT_ROWS} />
      <FieldLevels fields={empty ? [] : fieldLevels(MAP, READINGS, FIELD_TAGS, FIELDS)} />
    </PageColumn>
  );
}

export function LearnKnowLensesPreview() {
  return <KnowLenses />;
}

/** Before any subject has moved onto topics: the claims graph's counts, no fields. */
export function LearnKnowLensesEmptyPreview() {
  return <KnowLenses empty />;
}
