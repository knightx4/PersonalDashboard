import { ModuleView, ModulesIndexView } from '@/app/dev/modules/modules-view';
import { moduleSummaries, moduleSummary, type ModuleInputs } from '@/lib/dev/module-page';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { IdeaRow } from '@/lib/ideas/load';
import { moduleById } from '@/lib/modules';
import type { PlanItem } from '@/lib/plan/load';
import type { ScopeReview } from '@/lib/ui-review/load';
import { usageReport } from '@/lib/usage/report';

/**
 * The module pages in Dev (/dev/modules), drawn from fixtures for the gallery:
 * the index of every workspace, and the Job search page's Overview.
 *
 * No clock: every date is fixed and `now` is passed in, so two shots taken
 * minutes apart do not differ.
 */

let counter = 1700;

function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'jobs',
    parentId: null,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-01T09:00:00Z',
    ...over,
  };
}

function note(over: Partial<FeedbackRow> & Pick<FeedbackRow, 'id' | 'body'>): FeedbackRow {
  return {
    kind: 'bug',
    pagePath: null,
    status: 'open',
    priority: 2,
    resolutionNote: null,
    commitSha: null,
    createdAt: '2026-10-03T14:00:00Z',
    completedAt: null,
    thread: [],
    triage: null,
    ...over,
  };
}

function idea(over: Partial<IdeaRow> & Pick<IdeaRow, 'id' | 'body'>): IdeaRow {
  return {
    module: 'jobs',
    createdAt: '2026-09-30T09:00:00Z',
    planItem: null,
    source: 'me',
    from: null,
    dismissedAt: null,
    thread: [],
    triage: null,
    score: null,
    ...over,
  };
}

const review: ScopeReview = {
  scope: 'jobs',
  lastReview: {
    id: 'r-jobs',
    scope: 'jobs',
    commitSha: 'a1b2c3d',
    violations: 2,
    note: 'Looked at the pipeline and the role page. The board holds up at phone width.',
    createdAt: '2026-09-28T10:00:00Z',
    findings: [],
  },
  openFindings: [],
};

const inputs: ModuleInputs = {
  plan: [
    item({
      id: 'f1',
      title: 'Bulk-move roles between stages from the pipeline',
      status: 'in_progress',
      updatedAt: '2026-10-07T09:00:00Z',
    }),
    item({ id: 'f1a', title: 'Select several cards on the board', parentId: 'f1', module: null }),
    item({ id: 'f2', title: 'Follow-up reminders from the last email on a role', updatedAt: '2026-10-05T09:00:00Z' }),
    item({ id: 'f3', title: 'Salary bands on the companies page', status: 'proposed' }),
    item({
      id: 's1',
      title: 'Let Dash move or archive many job roles at once',
      status: 'done',
      completedAt: '2026-10-07T16:00:00Z',
    }),
    item({
      id: 's2',
      title: 'Show the interview prep beside the calendar entry',
      status: 'done',
      completedAt: '2026-10-02T12:00:00Z',
    }),
    item({ id: 'v1', title: 'Week view in the vault', module: 'vault' }),
  ],
  bugs: [
    note({
      id: 'n1',
      body: 'The stage menu on a role card opens off the edge of the screen on my phone',
      pagePath: '/jobs/pipeline',
    }),
    note({
      id: 'n2',
      kind: 'feature',
      body: 'Let me paste a posting link and have the role filled in',
      pagePath: '/jobs/roles/42',
    }),
    note({ id: 'n3', body: 'Vault search misses notes with accents', pagePath: '/vault' }),
  ],
  ideas: [
    idea({ id: 'i1', body: 'A weekly digest of roles that went quiet' }),
    idea({ id: 'i2', body: 'Compare two offers side by side', source: 'claude' }),
    idea({ id: 'i3', body: 'Shopping receipts read from photos', module: 'shopping' }),
  ],
  visions: {
    jobs: {
      body: 'The job search in one place: every role, where it stands, and the next thing to send.',
    },
  },
  ui: [review],
  ...(() => {
    const report = usageReport(
      [
        { route: '/jobs/pipeline', workspace: 'jobs', opens7: 12, opens30: 61, lastOpened: '2026-10-07T19:00:00Z' },
        { route: '/jobs', workspace: 'jobs', opens7: 9, opens30: 40, lastOpened: '2026-10-07T08:00:00Z' },
        { route: '/todo', workspace: 'todo', opens7: 30, opens30: 118, lastOpened: '2026-10-08T08:12:00Z' },
      ],
      [{ module: 'jobs', spend7: 420_000, spend30: 1_960_000, calls30: 88, unpriced30: 0 }],
    );
    return { usage: report.groups, notOpened: report.notOpened };
  })(),
};

export function DevModulesSurface() {
  return <ModulesIndexView summaries={moduleSummaries(inputs)} />;
}

export function DevModuleSurface() {
  return (
    <ModuleView
      summary={moduleSummary(moduleById('jobs')!, inputs)}
      tab="overview"
      now={new Date('2026-10-08T12:00:00Z')}
    />
  );
}
