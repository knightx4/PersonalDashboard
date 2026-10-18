'use client';

import { InsightsView, type InsightsActions, type InsightsOpen } from '@/app/you/insights/insights-view';
import { InsightsSkeleton } from '@/app/you/insights/insights-skeleton';
import type { Insight, InsightRun } from '@/lib/you/insights';
import { insightRunState } from '@/lib/you/insights-run';

/**
 * The Insights tab in the gallery (plan #2413.5): three insights waiting,
 * one marked wrong and one not quite under Earlier, and each hidden part
 * drawn open. The fixtures run long, as a run's prose does.
 */

const NOW = Date.parse('2026-10-18T09:00:00Z');

const actions: InsightsActions = {
  mark: async (_id, verdict, note) => ({
    error: null,
    saved: { verdict, note: note ?? null, decidedAt: new Date(NOW).toISOString() },
  }),
  lookAgain: async () => ({ error: null }),
};

const waiting: Insight[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    runId: null,
    kind: 'pattern',
    claim:
      'You start something new each time a project reaches the part where other people would judge it, and the new thing is always one you can finish alone.',
    layers: [
      {
        depth: 'saw',
        text: 'Three side projects in your vault stop within a week of the note that says "show it to someone": the recipe site, the running log and the board game rules.',
      },
      {
        depth: 'deeper',
        text: 'Each replacement was smaller and private. The judgement, more than the work, is what you step away from.',
      },
      {
        depth: 'further',
        text: 'Your Big Five puts neuroticism high and your notes on the job search say the same thing about interviews, so the pattern likely reaches past side projects into how you look for work.',
      },
    ],
    receipts: [
      {
        source: 'Projects/Recipe site.md',
        rowId: null,
        quote: 'Next: show it to Sam and get a real opinion.',
        link: '/vault/Projects/Recipe%20site.md',
      },
      {
        source: 'Projects/Running log.md',
        rowId: null,
        quote: 'Ready for the club to try. Maybe after one more pass.',
        link: '/vault/Projects/Running%20log.md',
      },
      {
        source: 'you.personality_results',
        rowId: 'b5',
        quote: 'Neuroticism 78th percentile',
        link: '/you/personality',
      },
    ],
    confidence: 'medium',
    liveRef: 'the portfolio review on 24 October',
    status: 'shown',
    supersededBy: null,
    createdAt: '2026-10-17T21:10:00Z',
    verdict: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    runId: null,
    kind: 'tension',
    claim: 'You say you want to live somewhere quiet, but every place you were happiest was in the middle of a city.',
    layers: [
      { depth: 'saw', text: 'Your places list rates Lisbon and Chicago highest, and both were city-centre flats.' },
      { depth: 'deeper', text: 'Quiet may stand in for having time of your own rather than for fewer people around.' },
    ],
    receipts: [
      { source: 'you.places', rowId: 'p2', quote: 'Lisbon, 5 of 5', link: '/you/places' },
      { source: 'Journal/2026-08-02.md', rowId: null, quote: 'I want somewhere quiet next.', link: '/vault/Journal/2026-08-02.md' },
    ],
    confidence: 'hunch',
    liveRef: null,
    status: 'shown',
    supersededBy: null,
    createdAt: '2026-10-17T21:10:00Z',
    verdict: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    runId: null,
    kind: 'strength',
    claim: 'You finish courses you pick yourself and drop the ones someone else chose for you.',
    layers: [
      { depth: 'saw', text: 'Four of the five courses you finished in Learn were ones you added; both you dropped came from work.' },
      { depth: 'deeper', text: 'Choosing it is what keeps you going, more than the subject.' },
    ],
    receipts: [{ source: 'learn.courses', rowId: 'c4', quote: '4 of 5 finished were added by you', link: null }],
    confidence: 'high',
    liveRef: null,
    status: 'shown',
    supersededBy: null,
    createdAt: '2026-10-17T21:10:00Z',
    verdict: null,
  },
];

const marked: Insight[] = [
  {
    id: '00000000-0000-4000-8000-000000000004',
    runId: null,
    kind: 'pattern',
    claim: 'You avoid the phone and do everything you can by email.',
    layers: [{ depth: 'saw', text: 'Most of your job search replies are by email.' }],
    receipts: [],
    confidence: 'medium',
    liveRef: null,
    status: 'retired',
    supersededBy: null,
    createdAt: '2026-10-10T21:10:00Z',
    verdict: {
      verdict: 'wrong',
      note: 'Recruiters email first, so I answer that way. I am fine on the phone.',
      decidedAt: '2026-10-11T08:00:00Z',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    runId: null,
    kind: 'value',
    claim: 'You care more about who you work with than about what the company makes.',
    layers: [{ depth: 'saw', text: 'Your notes on companies mention the team before the product.' }],
    receipts: [],
    confidence: 'medium',
    liveRef: null,
    status: 'shown',
    supersededBy: null,
    createdAt: '2026-10-10T21:10:00Z',
    verdict: { verdict: 'not_quite', note: 'Both matter; the team decides between two good products.', decidedAt: '2026-10-11T08:05:00Z' },
  },
];

const run = (status: InsightRun['status'], error: string | null = null): InsightRun => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  status,
  summary: null,
  error,
  runUrl: status === 'running' ? 'https://claude.ai/code/session_example' : null,
  requestedAt: '2026-10-18T08:40:00Z',
  startedAt: status === 'queued' ? null : '2026-10-18T08:41:00Z',
  finishedAt: null,
});

export function YouInsightsPreview({
  open,
  state = 'ready',
  empty = false,
}: {
  open?: InsightsOpen;
  state?: 'ready' | 'running' | 'failed';
  empty?: boolean;
}) {
  const latest =
    state === 'running'
      ? run('running')
      : state === 'failed'
        ? run('failed', 'Dash could not start the run. The routine answered 529: overloaded.')
        : run('ready');
  return (
    <InsightsView
      insights={empty ? [] : [...waiting, ...marked]}
      run={insightRunState(empty && state === 'ready' ? null : latest, NOW)}
      runWhen="Today, 9:40 AM BST"
      available
      actions={actions}
      open={open}
    />
  );
}

export function YouInsightsLoadingPreview() {
  return <InsightsSkeleton />;
}
