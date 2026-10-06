import { PageHeader } from '@/components/shell/page-header';
import { FeedbackQueueView } from '@/components/feedback/feedback-queue';
import { OtherUsersFeedback } from '@/components/feedback/other-users';
import { IdeasView } from '@/app/dev/ideas/ideas-view';
import { UsageScreen } from '@/app/dev/usage/usage-view';
import { ReviewView, type Standing } from '@/app/dev/ui/review/review-view';
import { SpecsView } from '@/app/dev/specs/specs-view';
import { SpecDocView } from '@/app/dev/specs/[slug]/spec-doc-view';
import { ChangelogView } from '@/app/dev/changelog/changelog-view';
import { RaisedView } from '@/app/dev/raised/raised-view';
import { ConversationsView } from '@/app/dev/raised/conversations-view';
import { StatusPanel } from '@/app/dev/raised/status-panel';
import { AccountView } from '@/app/account/view';
import {
  isOutstanding,
  sortOutstanding,
  type FeedbackQueue,
  type FeedbackRow,
  type OtherFeedbackRow,
} from '@/lib/feedback/load';
import type { IdeaList, IdeaRow } from '@/lib/ideas/load';
import { usageReport } from '@/lib/usage/report';
import type { UiReview } from '@/lib/ui-review/load';
import { specBySlug } from '@/lib/specs/registry';
import { splitSections } from '@/lib/specs/sections';
import { parseRules } from '@/lib/specs/rules';
import { ruleStates } from '@/lib/specs/rule-states';
import type { ChangelogEntry } from '@/lib/changelog/entries';
import type { RaisedQueue, RaisedRow } from '@/lib/raised/load';
import type { WaitingGroup, WaitingRow } from '@/lib/plan/waiting';
import type { Conversation } from '@/lib/comments/recent';
import type { ConnectedApp } from '@/lib/connector/apps';

/**
 * The Dev pages and the account page in the surface gallery (plan #1600),
 * each drawn by the view its page hands its reads to, from fixtures shaped
 * like the live rows. Each sits in the 3xl column its page draws.
 */

const column = (children: React.ReactNode) => <div className="mx-auto max-w-3xl space-y-6">{children}</div>;

// ---- Bugs and requests ----------------------------------------------------

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

const notes: FeedbackRow[] = [
  note({
    id: 'n1',
    body: 'The plan page scrolls sideways on my phone when a step title is long and has a link in it',
    pagePath: '/dev/plan',
    priority: 1,
  }),
  note({
    id: 'n2',
    kind: 'feature',
    body: 'Let me snooze a todo to next Monday from the swipe, without opening it',
    pagePath: '/todo',
    createdAt: '2026-10-02T09:30:00Z',
  }),
  note({
    id: 'n3',
    status: 'blocked',
    body: 'Receipts from the Apple Store come in without a total',
    pagePath: '/shopping/orders',
    resolutionNote: 'Needs a sample receipt: the two in the inbox are both refunds.',
    createdAt: '2026-09-29T18:00:00Z',
  }),
  note({
    id: 'n4',
    kind: 'like',
    body: 'Quick read remembering where I stopped is great',
    pagePath: '/news',
    createdAt: '2026-09-28T07:45:00Z',
  }),
  note({
    id: 'n5',
    status: 'done',
    body: 'The week review link on Home goes to last week',
    pagePath: '/home',
    resolutionNote: 'Fixed: it opens the newest review.',
    commitSha: 'c0ffee1',
    createdAt: '2026-09-26T10:00:00Z',
    completedAt: '2026-09-27T12:00:00Z',
  }),
];

const outstanding = sortOutstanding(notes.filter(isOutstanding));
const queue: FeedbackQueue = {
  rows: notes,
  outstanding,
  closed: notes.filter((row) => !isOutstanding(row)),
  blocked: outstanding.filter((row) => row.status === 'blocked'),
};

const others: OtherFeedbackRow[] = [
  {
    id: 'o1',
    email: 'sam.friend@example.com',
    kind: 'bug',
    body: 'Sign up with Google sent me back to the sign-in page twice',
    pagePath: '/signup',
    createdAt: '2026-10-01T20:10:00Z',
  },
];

export function DevBugsSurface() {
  return column(
    <>
      <PageHeader
        title="Bugs and requests"
        description="Everything captured from the header button, from any workspace. Say “knock out the notes” in a session to have them worked top to bottom."
      />
      <FeedbackQueueView queue={queue} kind={null} />
      <OtherUsersFeedback rows={others} />
    </>,
  );
}

// ---- Ideas ----------------------------------------------------------------

function idea(over: Partial<IdeaRow> & Pick<IdeaRow, 'id' | 'body'>): IdeaRow {
  return {
    module: null,
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

const ideas: IdeaList = {
  mine: [
    idea({
      id: 'i1',
      module: 'shopping',
      body: 'Read receipts from photos of paper receipts, the way order emails are read',
      score: { value: 74, confidence: 0.9, at: '2026-09-30T09:01:00Z' },
    }),
    idea({
      id: 'i2',
      module: 'learn',
      body: 'A weekly quiz that mixes questions from every course I am taking',
      createdAt: '2026-09-25T09:00:00Z',
      score: { value: 58, confidence: 0.6, at: '2026-09-25T09:01:00Z' },
    }),
    idea({ id: 'i3', body: 'Dash reads my calendar and warns me about a busy week on Sunday night' }),
  ],
  suggested: [
    idea({
      id: 's1',
      module: 'jobs',
      source: 'claude',
      body: 'Draft a follow-up email a week after an interview with no reply',
      from: { number: 1312, title: 'Track every interview round' },
      score: { value: 66, confidence: 0.85, at: '2026-10-01T09:01:00Z' },
    }),
  ],
  lowScored: [],
  shaped: [
    idea({
      id: 'p1',
      module: 'todo',
      body: 'Close the day with what got done',
      planItem: { id: 'f1', number: 1440, title: 'Close the day on Todo', status: 'done' },
    }),
  ],
  dismissed: [],
};

export function DevIdeasSurface() {
  return column(
    <>
      <PageHeader
        title="Ideas"
        description="Long-term ideas, for the app as a whole or for one workspace. Nothing here does anything on its own — it is a place to put the thought."
      />
      <IdeasView ideas={ideas} grouping="workspace" sort="score" />
    </>,
  );
}

// ---- Usage ----------------------------------------------------------------

const report = usageReport(
  [
    { route: '/home', workspace: null, opens7: 41, opens30: 160, lastOpened: '2026-10-04T08:10:00Z' },
    { route: '/todo', workspace: 'todo', opens7: 30, opens30: 118, lastOpened: '2026-10-04T08:12:00Z' },
    { route: '/news', workspace: 'news', opens7: 22, opens30: 75, lastOpened: '2026-10-04T07:30:00Z' },
    { route: '/jobs/pipeline', workspace: 'jobs', opens7: 12, opens30: 61, lastOpened: '2026-10-03T19:00:00Z' },
    { route: '/learn/now', workspace: 'learn', opens7: 3, opens30: 20, lastOpened: '2026-10-01T21:00:00Z' },
    { route: '/vault/map', workspace: 'vault', opens7: 0, opens30: 0, lastOpened: '2026-08-12T10:00:00Z' },
    { route: '/shopping/returns', workspace: 'shopping', opens7: 0, opens30: 0, lastOpened: null },
  ],
  [
    { module: 'news', spend7: 1_840_000, spend30: 7_310_000, calls30: 412, unpriced30: 0 },
    { module: 'learn', spend7: 960_000, spend30: 5_020_000, calls30: 230, unpriced30: 3 },
    { module: 'core', spend7: 410_000, spend30: 1_900_000, calls30: 96, unpriced30: 0 },
  ],
);

export function DevUsageSurface() {
  return <UsageScreen report={report} now={new Date('2026-10-04T12:00:00Z')} />;
}

// ---- UI review ------------------------------------------------------------

const vaultReview: UiReview = {
  id: 'r1',
  scope: 'vault',
  commitSha: 'abc1234',
  violations: 0,
  note: 'Left the settings page alone; it is mid-rewrite.',
  createdAt: '2026-09-29T09:00:00.000Z',
  findings: [
    {
      id: 'f1',
      file: 'app/vault/page.tsx',
      line: 101,
      law: '11',
      surface: 'vault-note',
      body: 'The folder heading is a frame around a frame.',
      status: 'open',
      note: null,
      createdAt: '2026-09-29T09:01:00.000Z',
      decidedAt: null,
    },
  ],
};

const standings: Standing[] = [
  { scope: 'jobs', label: 'Job search', violations: 1, surfaces: 24, lastReview: null },
  { scope: 'vault', label: 'Vault', violations: 0, surfaces: 9, lastReview: vaultReview },
  { scope: 'learn', label: 'Learn', violations: 3, surfaces: 12, lastReview: null },
  { scope: 'shared', label: 'Shared', violations: 1, surfaces: 14, lastReview: null },
];

export function DevUiReviewSurface() {
  return column(
    <>
      <PageHeader
        title="Review"
        description="One module at a time: what the gate counts, what there is to look at, and what the last pass found."
      />
      <ReviewView standings={standings} only={null} />
    </>,
  );
}

// ---- Specs ----------------------------------------------------------------

export function DevSpecsSurface() {
  return (
    <SpecsView
      counts={{ 'ui-quality': 4, plan: 1 }}
      visions={{
        app: {
          module: 'app',
          body: 'It should make working with an AI builder easy, and the app it builds should be one I use every day.',
          updatedAt: '2026-09-20T09:00:00Z',
        },
        jobs: {
          module: 'jobs',
          body: 'Every application from first lead to offer in one place, so nothing falls through between an email and an interview.',
          updatedAt: '2026-09-18T09:00:00Z',
        },
      }}
      edits={{}}
      changes={[]}
      audit={{ auditAt: null, findings: [] }}
    />
  );
}

const SPEC_MARKDOWN = `# UI quality

## Part 5: Checks a picture cannot do

Scripted browser checks run against the preview build at 390 pixels wide. Four run on every surface in the gallery: nothing scrolls sideways, every press target is at least 44 by 44 pixels, nothing a person can press sits under the dock, and text over a panel meets the contrast floor.

They run in the gate on the surfaces the commit touched, so they add seconds rather than minutes.

## Rules

**R1.** Every page under \`app/\` has at least one surface in the gallery.
Checked by: count \`routes-without-surface\`, baseline 72, target 0.

**R2.** Animation timings and easings come from the motion tokens.
Checked by: count \`raw-motion-values\`, baseline 234, target 0.
`;

const uiQuality = specBySlug('ui-quality')!;
const specSections = splitSections(SPEC_MARKDOWN).map((section, index) => ({
  ...section,
  id: `s${index}`,
  thread:
    index === 0
      ? [
          {
            id: 'c1',
            author: 'me' as const,
            body: 'Does the dock check count a bar that only appears after scrolling?',
            createdAt: '2026-10-03T10:00:00Z',
          },
          {
            id: 'c2',
            author: 'claude' as const,
            body: 'Yes. It looks at the top of the page and again at the bottom, so a bar that appears on scroll is measured in both places.',
            createdAt: '2026-10-03T10:02:00Z',
          },
        ]
      : [],
}));
const specStates = ruleStates(parseRules(SPEC_MARKDOWN), {
  baseline: { 'routes-without-surface': 61, 'raw-motion-values': 234 },
  counters: new Map([
    ['routes-without-surface', { target: 0 }],
    ['raw-motion-values', { target: 0 }],
  ]),
});

export function DevSpecSurface() {
  return (
    <SpecDocView
      doc={uiQuality}
      sections={specSections}
      orphans={[]}
      states={specStates}
      audit={{ auditAt: null, findings: [] }}
    />
  );
}

// ---- Changelog ------------------------------------------------------------

function shipped(
  over: Partial<ChangelogEntry> & Pick<ChangelogEntry, 'key' | 'title' | 'at'>,
): ChangelogEntry {
  return {
    source: 'plan',
    id: over.key,
    number: null,
    day: over.at.slice(0, 10),
    module: null,
    detail: null,
    commitSha: null,
    issue: null,
    ...over,
  };
}

const phoneFeature = { id: 'f1536', number: 1536, title: 'Check every screen at phone width automatically' };

const changelog: ChangelogEntry[] = [
  shipped({
    key: 'e1',
    number: 1539,
    title: 'Keep every page covered by the gallery',
    detail: 'A count of the pages no gallery surface stands for, held so it can only go down.',
    at: '2026-10-04T01:20:00Z',
    module: 'dev',
    commitSha: '81b8fb1',
    issue: phoneFeature,
  }),
  shipped({
    key: 'e2',
    number: 1538,
    title: 'Check decks and links respond at once',
    at: '2026-10-04T00:40:00Z',
    module: 'dev',
    commitSha: '20e66f8',
    issue: phoneFeature,
  }),
  shipped({
    key: 'e3',
    source: 'note',
    title: 'The week review link on Home opens the newest review',
    at: '2026-10-03T16:00:00Z',
    module: null,
    commitSha: 'c0ffee1',
  }),
  shipped({
    key: 'e4',
    number: 1440,
    title: 'Close the day on Todo',
    detail: 'Ticking the last thing due today folds the done items into a pile and says how many were finished.',
    at: '2026-10-02T11:00:00Z',
    module: 'todo',
    commitSha: 'deadbee',
  }),
];

export function DevChangelogSurface() {
  return <ChangelogView entries={changelog} grouping="issue" query="" workspace={null} />;
}

// ---- Dev home: what is waiting on you --------------------------------------

function waiting(over: Partial<WaitingRow> & Pick<WaitingRow, 'id' | 'number' | 'title' | 'health'>): WaitingRow {
  return {
    module: 'dev',
    job: false,
    ask: null,
    detail: null,
    resolution: null,
    proposedBeneath: 0,
    thread: [],
    ...over,
  };
}

const raise: RaisedRow = {
  id: 'r1',
  title: 'The share link page has no rate limit on its answer route',
  detail: 'Found while building the gallery surface for the shared form. Anyone with the link can send answers as fast as they like.',
  ask: 'Add a limit of thirty answers a minute per link?',
  consequence: null,
  outcome: null,
  module: 'shopping',
  source: 'plan #1599',
  status: 'open',
  createdAt: '2026-10-04T02:00:00Z',
  answeredAt: null,
  thread: [],
};

const groups: WaitingGroup[] = [
  {
    key: 'actions',
    title: 'Your actions',
    entries: [
      {
        kind: 'plan',
        id: 'w1',
        row: waiting({
          id: 'w1',
          number: 1490,
          title: 'Set GITHUB_TOKEN in Vercel',
          health: 'setup',
          ask: 'Project settings, Environment variables, add GITHUB_TOKEN for Production with read access to the repository.',
          detail: 'Project settings, Environment variables, add GITHUB_TOKEN for Production with read access to the repository.',
        }),
      },
    ],
  },
  {
    key: 'questions',
    title: 'Questions for you',
    entries: [
      {
        kind: 'plan',
        id: 'w2',
        row: waiting({
          id: 'w2',
          number: 1535,
          title: 'What happens after a third failed design round?',
          health: 'unanswered',
          detail:
            'A — Ship it and file the fixes as a note. Keeps the step moving.\nB — Block the step for you to look at. Nothing ships with a known fix outstanding.\nRecommend B.',
          ask: 'A — Ship it and file the fixes as a note. Keeps the step moving.\nB — Block the step for you to look at. Nothing ships with a known fix outstanding.\nRecommend B.',
        }),
      },
      { kind: 'raise', id: 'r1', raise },
    ],
  },
  { key: 'approve', title: 'To approve', entries: [] },
];

const raisedQueue: RaisedQueue = { rows: [raise], open: [raise], unfinished: [], closed: [], openCount: 1 };

const conversations: Conversation[] = [
  {
    target: 'step',
    rowId: 'w2',
    about: '#1536 Check every screen at phone width automatically',
    href: '/dev/plan?q=%231536',
    thread: [
      { id: 'm1', author: 'me', body: 'Does this cover the sign-in pages too?', createdAt: '2026-10-03T21:00:00Z' },
      {
        id: 'm2',
        author: 'claude',
        body: 'Yes. Every page under app/ is counted, and the sign-in pages are among the 72 without a surface yet.',
        createdAt: '2026-10-03T21:01:00Z',
      },
    ],
    lastAt: '2026-10-03T21:01:00Z',
    lastAuthor: 'claude',
    unread: true,
  },
];

export function DevRaisedSurface() {
  return column(
    <>
      <PageHeader
        title="Home"
        description="What happened in the last day, the questions waiting on you, and every conversation you have had with Dash. Answer a question and the next run reads it; reply to a conversation and it goes back on the row it was started on."
      />
      <RaisedView queue={raisedQueue} groups={groups} />
      <ConversationsView conversations={conversations} />
    </>,
  );
}

/**
 * The Status panel at the top of Home in Dev: the plan runner resting with
 * three features ready, and the notes routine with twelve notes open. Dash's
 * mark sits under Plan (note 076e7744).
 */
export function DevRaisedStatusSurface() {
  return column(
    <StatusPanel
      run={null}
      canSend
      card={{ night: null, on: [], progress: null, push: null, ready: 3, readySteps: 9, next: [] }}
      goals={null}
      openNotes={12}
      notesLastRun={null}
      vision={null}
      now={Date.parse('2026-10-06T08:00:00Z')}
    />,
  );
}

// ---- Account --------------------------------------------------------------

const apps: ConnectedApp[] = [
  {
    clientId: 'claude',
    name: 'Claude',
    grantedAt: '2026-09-12T15:00:00Z',
    calls: [
      {
        id: 'k1',
        label: 'Searched',
        asked: 'interview with Array',
        outcome: 'ok',
        error: null,
        at: '2026-10-03T19:20:00Z',
        reads: [],
      },
      {
        id: 'k2',
        label: 'Read job applications',
        asked: null,
        outcome: 'ok',
        error: null,
        at: '2026-10-03T19:19:00Z',
        reads: [],
      },
    ],
  },
];

export function AccountSurface() {
  return column(
    <>
      <p className="text-body text-ink-muted">Settings that hold across every workspace.</p>
      <AccountView
        email="christopher.kloughton@example.com"
        settings={{
          displayName: 'Chris',
          timezone: 'America/New_York',
          displayCurrency: 'USD',
          enabledModules: ['shopping', 'jobs', 'todo', 'vault', 'learn', 'news', 'goals'],
        }}
        isOwner
        vapidPublicKey={null}
        connected={{ apps, failed: null, connectorAddress: 'https://dash.example.com/api/mcp' }}
      />
    </>,
  );
}
