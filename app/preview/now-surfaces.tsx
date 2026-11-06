import { PageColumn } from '@/components/shell/page-width';
import { PageHeader } from '@/components/shell/page-header';
import { sectionSubject } from '@/lib/core/section-path';
import { NowSection } from '@/app/dev/plan/now-section';
import { ProjectMainLine } from '@/app/dev/plan/project-main-line';
import type { MainCheck } from '@/lib/plan/main-check';
import type { NowList, NowSession, NowStep } from '@/lib/plan/now';

/**
 * The Now section at the top of a project's page and Dev's plan (plan
 * #2800.3), drawn on a project's page: sessions working, one waiting on you
 * with its question's choices, one gone quiet, and nothing running.
 */

const NOW = Date.parse('2026-11-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const step = (ref: string, title: string, number: number): NowStep => ({
  id: `step-${number}`,
  ref,
  title,
  href: `/dev/plan/${number}`,
  module: 'website',
});

const reporting: NowSession = {
  key: 'report:cse_1',
  source: 'report',
  state: 'working',
  action: 'Committed 4e1a9c2: List the essays from their front matter, newest first, with the reading time beside each',
  needs: null,
  at: ago(2),
  step: step('#12.3', 'List the essays from their front matter', 3012),
  project: 'website',
  question: null,
  runId: 'run-1',
};

const guessed: NowSession = {
  key: 'guess:run-2',
  source: 'guess',
  state: 'working',
  action: 'Pushed: Build the feed from the essay list',
  needs: null,
  at: ago(6),
  step: step('#12.4', 'Add an RSS feed for the writing page', 3013),
  project: null,
  question: null,
  runId: 'run-2',
};

const waiting: NowSession = {
  key: 'report:cse_3',
  source: 'report',
  state: 'waiting',
  action: 'Drew the domain settings and stopped before changing DNS',
  needs: 'Should www redirect to the apex domain, or the apex to www?',
  at: ago(14),
  step: step('#14', 'Serve the site from the apex domain and the www name', 3020),
  project: 'website',
  question: {
    runId: '00000000-0000-4000-8000-000000000003',
    body: 'Should www redirect to the apex domain, or the apex to www?',
    options: ['www to the apex', 'The apex to www'],
  },
  runId: '00000000-0000-4000-8000-000000000003',
};

const waitingNoChoices: NowSession = {
  key: 'report:cse_4',
  source: 'report',
  state: 'waiting',
  action: 'Needs a token to read the analytics',
  needs: 'Set PLAUSIBLE_API_KEY in the site’s Vercel settings, then tell me here.',
  at: ago(31),
  step: step('#15.2', 'Show page views on the writing page', 3031),
  project: 'website',
  question: null,
  runId: null,
};

const quiet: NowSession = {
  ...reporting,
  key: 'report:cse_5',
  step: step('#12.5', 'Show the reading time beside each essay', 3014),
  action: 'Running the tests for the reading time',
  at: ago(34),
};

const LISTS: Record<NowVariant, NowList> = {
  working: { sessions: [reporting, guessed], finished: null },
  waiting: { sessions: [waiting, waitingNoChoices, reporting], finished: null },
  stale: { sessions: [reporting, quiet], finished: null },
  empty: {
    sessions: [],
    finished: {
      state: 'done',
      action: 'Committed 9b02d17: Add an RSS feed for the writing page',
      at: ago(95),
      step: step('#12.4', 'Add an RSS feed for the writing page', 3013),
    },
  },
};

const mainPassed: MainCheck = {
  sha: 'e81f2a94c0d3b6a7f5e2c1d0b9a8f7e6d5c4b3a2',
  conclusion: 'passed',
  checkedAt: '2026-11-04T11:58:00Z',
  error: null,
  reason: null,
  runUrl: null,
  deployState: 'deployed',
  deployUrl: null,
  deployError: null,
  unapplied: null,
  migrationsError: null,
};

export type NowVariant = 'working' | 'waiting' | 'stale' | 'empty';

export function NowSurface({ variant }: { variant: NowVariant }) {
  return (
    <PageColumn className="space-y-6">
      <PageHeader
        subject={sectionSubject('/dev/projects', 'Projects', { label: 'Personal site', href: '/dev/projects/website' })}
        title="Personal site"
        description="Built in alex-rivera/alexrivera-site"
      />
      <NowSection list={LISTS[variant]} now={NOW} live={false} />
      <ProjectMainLine check={mainPassed} repo="alex-rivera/alexrivera-site" now={NOW} />
    </PageColumn>
  );
}
