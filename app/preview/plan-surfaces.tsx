import { PageHeader } from '@/components/shell/page-header';
import { projectById } from '@/lib/plan/projects';
import { PlanView } from '@/app/dev/plan/plan-view';
import { SendScreenBack } from '@/app/dev/plan/send-back';
import { FeaturePage } from '@/app/dev/plan/feature-page';
import type { PlanUpdate } from '@/lib/plan/updates';
import { catalogOf } from '@/app/dev/plan/plan-catalog';
import { SetTab } from './set-tab';
import { ScreenChanges } from '@/components/dev/screen-change';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import type { CriticStopView } from '@/lib/plan/ui-check-stop';
import type { ScreenChangeView } from '@/lib/plan/screen-change';
import type { LastRun } from '@/lib/plan/run-end';
import { applyView, buildPlanTree, summarize } from '@/lib/plan/tree';

/**
 * The dev plan, drawn from fixtures for the gallery (plan #993).
 *
 * Here so the plan page can be photographed before and after a change to how
 * its rows are drawn: #980 moves the row and the tree into shared components,
 * and the check that nothing moved is that these shots do not change. Every
 * state a row can be in is somewhere in the tree -- a feature with fog, one
 * with a question beneath it, a proposal, a block, a setup job, a step
 * waiting on another, a finished step and a dropped one.
 *
 * No clock anywhere in it. A step underway carries no start time, because the
 * row would print how long it has been going and two shots taken minutes
 * apart would differ for that reason alone.
 */

let counter = 900;

function item(over: Partial<PlanItem> & { id: string; title: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'goals',
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

const dep = (itemId: string, dependsOnId: string): PlanDependency => ({
  id: `${itemId}->${dependsOnId}`,
  itemId,
  dependsOnId,
});

const items: PlanItem[] = [
  item({
    id: 'goal-tree',
    title: 'Make the goal page use the dev plan’s tree',
    detail: 'Goals looks and works like the dev plan because it is drawn by the same components.',
    acceptance: 'A goal page and /dev/plan read the same at phone and laptop width.',
    priority: 1,
    size: 'l',
  }),
  item({
    id: 'shared',
    parentId: 'goal-tree',
    title: 'Move the plan row and tree into shared components',
    detail: 'The dev plan looks and works exactly as it does now.',
    acceptance: 'The dev plan renders through the shared components.',
    status: 'in_progress',
    size: 'l',
  }),
  item({
    id: 'gallery',
    parentId: 'shared',
    title: 'Show the dev plan in the preview gallery',
    status: 'done',
    size: 's',
    commitSha: 'a1b2c3d',
    completedAt: '2026-09-24T10:00:00Z',
    startedAt: '2026-09-24T09:00:00Z',
  }),
  item({
    id: 'words',
    parentId: 'shared',
    title: 'Move plan health and move wording into a pure module',
    size: 's',
  }),
  item({
    id: 'blocked-steps',
    parentId: 'goal-tree',
    title: 'Let goal steps be blocked and wait on other steps',
    detail: 'A goal step can be blocked with a one-line reason saying what it needs.',
    size: 'm',
    comment: 'Waiting on the shared row.',
  }),
  item({
    id: 'which-shape',
    parentId: 'blocked-steps',
    kind: 'decision',
    title: 'Which table holds a goal step’s dependencies?',
    detail:
      'A — A goals.dependencies table. Mirrors plan_dependencies.\nB — A column on the step. Simpler, holds one.\nRecommend A.',
  }),
  item({
    id: 'render',
    parentId: 'goal-tree',
    title: 'Render the goal page through the plan tree',
    size: 'm',
    assignee: 'me',
  }),
  item({
    id: 'overhaul',
    module: 'dev',
    track: 'overhaul',
    title: 'Draw every list row with one shared component',
    detail:
      'An overhaul (plan #1510): built by its own routine in phases, started with “Work this overhaul”.',
    acceptance: 'Every list row in the app is drawn by the shared row.',
    size: 'l',
  }),
  item({
    id: 'overhaul-design',
    module: 'dev',
    parentId: 'overhaul',
    title: 'Design the shared row on the Learn page',
    size: 'm',
  }),
  item({
    id: 'overhaul-running',
    module: 'dev',
    track: 'overhaul',
    title: 'Move every page to the shared header',
    detail: 'An overhaul with its routine running: the row says Dash is on it.',
    size: 'l',
  }),
  item({
    id: 'overhaul-running-step',
    module: 'dev',
    parentId: 'overhaul-running',
    title: 'Build the shared header beside the old one',
    size: 'm',
  }),
  item({
    id: 'fog-feature',
    title: 'Plan a week around the goals',
    fog: 'Which goals get a slot each week is not settled.',
    status: 'proposed',
    priority: 3,
  }),
  item({
    id: 'stuck',
    title: 'Import reading lists from the library',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: 'Which library account should it read?',
    detail: 'Reads the loans and holds from the library account.',
  }),
  item({
    id: 'key',
    parentId: 'stuck',
    kind: 'setup',
    title: 'Set LIBRARY_TOKEN in Vercel',
    detail: 'Project settings, Environment variables, add LIBRARY_TOKEN for Production.',
    assignee: 'me',
  }),
  item({
    id: 'gone',
    parentId: 'stuck',
    title: 'Scrape the catalogue page',
    status: 'dropped',
    completedAt: '2026-09-20T10:00:00Z',
  }),
];

const whole = buildPlanTree({
  items,
  dependencies: [dep('render', 'shared'), dep('blocked-steps', 'shared')],
});

const catalog = catalogOf(whole);

/**
 * The overhaul routine working one overhaul (plan #1514). Dated, but the tree
 * draws no time for it: a started run on an overhaul reads "Dash is on it" in
 * the Status column, and only the opened panel says how long it has gone.
 */
const treeRuns: Record<string, LastRun> = {
  'overhaul-running': {
    status: 'started',
    createdAt: '2026-09-01T09:00:00Z',
    error: null,
    job: 'overhaul',
    reading: null,
  },
};

/** The open view, every feature unfolded: the page as a list. */
export function PlanTreeSurface() {
  return (
    <PlanView
      sections={applyView(whole, 'open')}
      finished={[]}
      summary={summarize(whole)}
      view="open"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={treeRuns}
      commitChecks={{}}
      unfolded
    />
  );
}

/**
 * The Table view (plan #1669): every open feature as a row, grouped by
 * module, over the same fixtures as the tree.
 */
export function PlanTableSurface() {
  return (
    <PlanView
      sections={applyView(whole, 'table')}
      finished={[]}
      summary={summarize(whole)}
      view="table"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={treeRuns}
      commitChecks={{}}
    />
  );
}

/**
 * Two features with every row opened: the panel behind a row, which is where
 * the detail, the questions, the dependencies and the thread are drawn.
 */
export function PlanOpenedSurface() {
  const sections = applyView(whole, 'open')
    .map((section) => ({
      ...section,
      nodes: section.nodes.filter(
        (node) => node.id === 'stuck' || node.id === 'goal-tree' || node.id === 'overhaul',
      ),
    }))
    .filter((section) => section.nodes.length > 0);

  return (
    <PlanView
      sections={sections}
      finished={[]}
      summary={summarize(whole)}
      view="open"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
      unfolded
      opened
    />
  );
}

/**
 * A project's page in Dev (/dev/projects/[id]): the plan page drawn with only
 * that project's section, under the project's own header, its view links
 * kept on the project's page (plan #1600).
 */
const projectItems: PlanItem[] = [
  item({
    id: 'site-writing',
    module: 'website',
    title: 'Publish the writing page with the three essays already drafted',
    detail: 'The site gets a writing page listing each essay with its date.',
    acceptance: 'selveyknight.com/writing lists the three essays, newest first.',
    priority: 1,
    size: 'm',
  }),
  item({
    id: 'site-writing-list',
    module: 'website',
    parentId: 'site-writing',
    title: 'List the essays from their front matter',
    status: 'done',
    size: 's',
    commitSha: 'b4c5d6e',
    completedAt: '2026-09-30T10:00:00Z',
    startedAt: '2026-09-30T09:00:00Z',
  }),
  item({
    id: 'site-writing-rss',
    module: 'website',
    parentId: 'site-writing',
    title: 'Add an RSS feed for the writing page',
    size: 's',
  }),
  item({
    id: 'site-domain',
    module: 'website',
    title: 'Serve the site from the apex domain and the www name',
    status: 'proposed',
    priority: 3,
    detail: 'Points the A record at Vercel and redirects www to the apex.',
  }),
];

const project = buildPlanTree({ items: projectItems, dependencies: [] });
const site = projectById('website')!;

export function ProjectPlanSurface() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={site.label}
        description={`${site.description}, built from this plan in ${site.repo.owner}/${site.repo.repo}. Send a step to Dash and it is built there, pushed to ${site.repo.branch} and closed here with the commit.`}
      />
      <PlanView
        basePath="/dev/projects/website"
        sections={applyView(project, 'open')}
        finished={[]}
        summary={summarize(project)}
        view="open"
        catalog={catalogOf(project)}
        empty={false}
        canSend={false}
        lastRuns={{}}
        commitChecks={{}}
        unfolded
      />
    </div>
  );
}

/**
 * A step the design critic stopped after its third round (plan #1610): the
 * last fixes for each surface that did not pass, the shots where they were
 * uploaded and a line where they were not, and the two ways on.
 */
const stopAsk =
  "The design critic did not pass #1612's screen: jobs-contact after round 3 (2 fixes open, shots in ui-shots under 1612/jobs-contact/r3); jobs-contacts after round 3 (1 fix open, shots not uploaded, kept in .preview-shots/checks/ by the session that ran it). The work is on branch claude/contact-card. Look at the shots and the fixes, then accept it as it is, or say what to change.";

const stopItems: PlanItem[] = [
  item({
    id: 'contacts',
    module: 'jobs',
    title: 'Keep every contact at a company on one card',
    size: 'l',
  }),
  item({
    id: 'contact-card',
    module: 'jobs',
    parentId: 'contacts',
    title: 'Draw the contact card with the last conversation under the name',
    detail: 'The contact page leads with the person and the last thing said between you.',
    acceptance: 'A contact reads as one card at 390, with the last conversation under the name.',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: stopAsk,
    size: 'm',
  }),
];

const stopTree = buildPlanTree({ items: stopItems, dependencies: [] });

/**
 * A shot, drawn as a page in miniature so the gallery needs no bucket.
 * ui-ok-file: raw-hex -- the colours are a picture of a page, not the page's own theme.
 */
function fixtureShot(dark: boolean, wide: boolean): string {
  const bg = dark ? '#16181d' : '#f7f6f3';
  const card = dark ? '#22252c' : '#ffffff';
  const ink = dark ? '#5d6370' : '#c9c6bf';
  const w = wide ? 400 : 300;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 400"><rect width="${w}" height="400" fill="${bg}"/><rect x="16" y="20" width="${w - 32}" height="150" rx="10" fill="${card}"/><rect x="32" y="40" width="${w / 2}" height="14" rx="4" fill="${ink}"/><rect x="32" y="66" width="${w - 96}" height="10" rx="4" fill="${ink}"/><rect x="32" y="84" width="${w - 130}" height="10" rx="4" fill="${ink}"/><rect x="16" y="190" width="${w - 32}" height="90" rx="10" fill="${card}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const criticStops: Record<string, CriticStopView> = {
  'contact-card': {
    branch: 'claude/contact-card',
    surfaces: [
      {
        surface: 'jobs-contact',
        round: 3,
        fixes: [
          {
            shot: 'phone-light',
            where: 'the header, under the name',
            problem:
              'The company, the role and the last conversation wrap to three lines each at 390, so the card is a screen and a half tall before the first message.',
            breaks: 'taste:fits-one-screen',
            change:
              'Put the company and role on one line and fold the conversation to its first line.',
          },
          {
            shot: 'laptop-dark',
            where: 'the notes box',
            problem: 'The notes box sits inside the card inside a second card.',
            breaks: 'law 13',
            change: 'Drop the inner card and let the notes sit on the card itself.',
          },
        ],
        shots: [
          { name: 'phone-light', url: fixtureShot(false, false) },
          { name: 'phone-dark', url: fixtureShot(true, false) },
          { name: 'laptop-light', url: fixtureShot(false, true) },
          { name: 'laptop-dark', url: fixtureShot(true, true) },
        ],
      },
      {
        surface: 'jobs-contacts',
        round: 3,
        fixes: [
          {
            shot: 'phone-dark',
            where: 'each row',
            problem: 'The last-spoken date is bare text on the background in dark.',
            breaks: 'taste:no-bare-text',
            change: 'Put the date inside the row with the name.',
          },
        ],
        shots: [],
      },
    ],
  },
};

export function PlanCriticStopSurface() {
  return (
    <PlanView
      sections={applyView(stopTree, 'open')}
      finished={[]}
      summary={summarize(stopTree)}
      view="open"
      catalog={catalogOf(stopTree)}
      empty={false}
      canSend={false}
      lastRuns={{}}
      commitChecks={{}}
      criticStops={criticStops}
      unfolded
      opened
    />
  );
}

/**
 * A step that changed screens, opened (plan #1541): each surface's phone
 * picture before and after, side by side. One surface has both, one is new
 * and has no before, and one passed with its pictures never uploaded, which
 * is how a round recorded from the web arrives.
 */
const changedItems: PlanItem[] = [
  item({
    id: 'pictures',
    module: 'dev',
    title: 'See each screen change as before and after pictures',
    size: 'm',
  }),
  item({
    id: 'pictures-row',
    module: 'dev',
    parentId: 'pictures',
    title: 'Draw the contact card with the last conversation under the name',
    detail: 'The contact page leads with the person and the last thing said between you.',
    acceptance: 'A contact reads as one card at 390, with the last conversation under the name.',
    status: 'done',
    size: 's',
    commitSha: 'c0ffee1',
    startedAt: '2026-10-05T09:00:00Z',
    completedAt: '2026-10-05T11:00:00Z',
  }),
  item({
    id: 'pictures-next',
    module: 'dev',
    parentId: 'pictures',
    title: 'Send a screen back from its pictures',
    size: 's',
  }),
];

const changedTree = buildPlanTree({ items: changedItems, dependencies: [] });

/**
 * A phone screen in miniature, so the gallery needs no bucket. `crowded` is
 * the before: three stacked cards where the after has one.
 * ui-ok-file: raw-hex -- the colours are a picture of a page, not the page's own theme.
 */
export function phoneShot(crowded: boolean): string {
  const bg = '#f7f6f3';
  const card = '#ffffff';
  const ink = '#c9c6bf';
  const accent = '#8a7fd6';
  const cards = crowded
    ? [20, 150, 280, 410, 540]
        .map(
          (y) =>
            `<rect x="14" y="${y}" width="362" height="116" rx="10" fill="${card}"/><rect x="28" y="${y + 16}" width="200" height="14" rx="4" fill="${ink}"/><rect x="28" y="${y + 40}" width="300" height="10" rx="4" fill="${ink}"/><rect x="28" y="${y + 58}" width="320" height="10" rx="4" fill="${ink}"/><rect x="28" y="${y + 76}" width="260" height="10" rx="4" fill="${ink}"/>`,
        )
        .join('')
    : `<rect x="14" y="20" width="362" height="260" rx="12" fill="${card}"/><circle cx="58" cy="70" r="26" fill="${accent}"/><rect x="98" y="54" width="180" height="16" rx="4" fill="${ink}"/><rect x="98" y="78" width="120" height="10" rx="4" fill="${ink}"/><rect x="30" y="120" width="320" height="10" rx="4" fill="${ink}"/><rect x="30" y="140" width="280" height="10" rx="4" fill="${ink}"/><rect x="30" y="200" width="120" height="40" rx="20" fill="${accent}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 693"><rect width="390" height="693" fill="${bg}"/>${cards}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const changedNumber = changedItems[1].number;

export const screenChangeFixtures: Record<number, ScreenChangeView[]> = {
  [changedNumber]: [
    {
      surface: 'jobs-contact',
      round: 2,
      verdict: 'pass',
      checkedAt: '2026-10-05T10:40:00Z',
      before: phoneShot(true),
      after: phoneShot(false),
    },
    {
      surface: 'jobs-contact-empty',
      round: 1,
      verdict: 'pass',
      checkedAt: '2026-10-05T10:45:00Z',
      before: null,
      after: phoneShot(false),
    },
    {
      surface: 'jobs-contacts',
      round: 4,
      verdict: 'accepted',
      checkedAt: '2026-10-05T10:50:00Z',
      before: null,
      after: null,
    },
  ],
};

export function PlanScreenChangeSurface() {
  return (
    <PlanView
      sections={applyView(changedTree, 'all').filter((section) => section.nodes.length > 0)}
      finished={[]}
      summary={summarize(changedTree)}
      view="all"
      catalog={catalogOf(changedTree)}
      empty={false}
      canSend={false}
      lastRuns={{}}
      // CI passed on the merge, which is the usual state of a step whose
      // screens passed, and the row carries no mark for it.
      commitChecks={{
        c0ffee1: { mergeSha: 'facade1', conclusion: 'passed', checkedAt: '2026-10-05T11:30:00Z' },
      }}
      screenChanges={screenChangeFixtures}
      unfolded
      opened
    />
  );
}

/**
 * The thumbs-down under a finished step's pictures, opened on the first
 * surface to show what it asks, and closed under the second (plan #1542).
 */
export function PlanSendBackSurface() {
  const changes = screenChangeFixtures[changedNumber].slice(0, 2);
  return (
    <div className="max-w-2xl p-4">
      <ScreenChanges
        changes={changes}
        footer={(change) => (
          <SendScreenBack
            id="pictures-shipped"
            surface={change.surface}
            open={change.surface === changes[0].surface}
          />
        )}
      />
    </div>
  );
}

/**
 * A feature's own page (plan #1664), from fixtures: a feature partway
 * through, with a long title, a question still open, a step it waits on in
 * another feature, a note from Dash on its thread, and steps in every state
 * on the Steps tab, one of them with a substep.
 */
const featureItems: PlanItem[] = [
  item({
    id: 'feat',
    module: 'dev',
    title: 'Give each feature its own page with tabs, breadcrumbs and a column of its properties',
    summary: 'One page per feature that says how it stands, what moved and who has what left.',
    detail:
      'Each feature on the plan opens to its own page: breadcrumbs at the top, then Overview, Activity and Steps tabs, with a column of its properties beside them. The goal page moves onto the same layout so the two stay alike.',
    acceptance:
      'Opening a feature from /dev/plan or a goal from /goals shows the same layout: breadcrumbs, Overview, Activity and Steps tabs, and a properties column with progress split between you and Dash.',
    priority: 1,
    size: 'l',
    comment:
      'Added by session cse_01V1aoCMYL7Ckkar3cKSLtFf on 2026-10-06.\n\nBlocked 2026-10-06: waiting on the level names.',
    thread: [
      {
        id: 't1',
        author: 'me',
        body: 'Keep the row on /dev/plan as it is; only the title should open this.',
        createdAt: '2026-10-07T10:00:00Z',
      },
      {
        id: 't2',
        author: 'claude',
        body: 'Done that way: the row is unchanged and its title links here.',
        createdAt: '2026-10-07T10:05:00Z',
      },
    ],
  }),
  item({
    id: 'feat-question',
    module: 'dev',
    parentId: 'feat',
    kind: 'decision',
    title: 'Should the Steps tab open folded or unfolded?',
    detail:
      'A — Unfolded. Every step and substep shows at once.\nB — Folded. Only the steps show until you open one.\nRecommend A: a feature has a dozen steps at most.',
  }),
  item({
    id: 'feat-layout',
    module: 'dev',
    parentId: 'feat',
    title: 'Build the shared tabbed detail layout',
    status: 'done',
    size: 'm',
    commitSha: '79074ffd',
    startedAt: '2026-10-07T08:00:00Z',
    completedAt: '2026-10-07T09:00:00Z',
    createdAt: '2026-10-06T15:56:00Z',
    comment:
      'Added by session cse_01V1aoCMYL7Ckkar3cKSLtFf on 2026-10-06.\n\nDone 2026-10-07: Added the tabbed detail page pattern: breadcrumbs, a title, tabs that each have their own address, and a column of properties that becomes a grid of facts under the title on a phone.',
  }),
  item({
    id: 'feat-page',
    module: 'dev',
    parentId: 'feat',
    title: 'Open a feature on its own page with Overview',
    status: 'in_progress',
    size: 'm',
    createdAt: '2026-10-06T15:56:00Z',
    comment:
      'Blocked 2026-10-06: Which pattern should the page use? Waiting on the answer to the layout question.\nUnblocked 2026-10-07: the answer came back as the tabbed detail pattern.',
  }),
  item({
    id: 'feat-page-gallery',
    module: 'dev',
    parentId: 'feat-page',
    title: 'Draw the page in the gallery',
    size: 's',
  }),
  item({
    id: 'feat-update',
    module: 'dev',
    parentId: 'feat',
    title: 'Store Dash’s update on a feature, with a health',
    size: 'm',
    assignee: 'me',
  }),
  item({
    id: 'feat-goal',
    module: 'dev',
    parentId: 'feat',
    title: 'Move the goal page onto the shared layout',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: 'Which goal page parts go to Overview and which to Activity?',
    size: 'm',
    createdAt: '2026-10-06T15:56:00Z',
    startedAt: '2026-10-07T10:30:00Z',
    comment:
      'Blocked 2026-10-07: Which goal page parts go to Overview and which to Activity?',
  }),
  item({
    id: 'feat-layout-tabs',
    module: 'dev',
    parentId: 'feat-layout',
    title: 'Add a tabs control whose tabs are links carrying the tab in the address',
    status: 'done',
    size: 's',
    commitSha: '79074ffd',
  }),
  item({
    id: 'feat-table',
    module: 'dev',
    parentId: 'feat',
    title: 'Show the plan as a table of features',
    size: 'm',
  }),
  item({
    id: 'feat-old',
    module: 'dev',
    parentId: 'feat',
    title: 'Open the feature in a side sheet over the plan',
    status: 'dropped',
    size: 's',
    createdAt: '2026-10-06T15:56:00Z',
    completedAt: '2026-10-07T08:10:00Z',
    comment: 'Dropped 2026-10-07: the page replaces it; a sheet over the plan would show the same thing in less room.',
  }),
  item({
    id: 'other',
    module: 'dev',
    title: 'Name the plan’s levels module, feature, step and substep',
    status: 'in_progress',
    size: 's',
  }),
];

/** Every fixture is created the day the feature was shaped, unless it says otherwise. */
for (const fixture of featureItems) {
  if (fixture.createdAt === '2026-09-01T09:00:00Z') fixture.createdAt = '2026-10-06T15:55:00Z';
}

const featureTree = buildPlanTree({
  items: featureItems,
  dependencies: [dep('feat', 'other'), dep('feat-table', 'feat-page')],
});
const featureSection = featureTree.find((section) => section.module === 'dev');
const featureNode = featureSection?.nodes.find((node) => node.id === 'feat');

/** Dash's latest update on the feature, which heads Overview (plan #1666). */
const featureUpdates: PlanUpdate[] = [
  {
    id: 'update-2',
    featureId: 'feat',
    health: 'at_risk',
    body:
      'The tabbed detail layout is built and the feature opens on its own page, with its steps grouped by status. ' +
      'Moving the goal page onto the same layout is blocked on which of its parts belong on Overview and which on Activity, ' +
      'and that question is waiting on you.',
    stepsDoneBefore: 1,
    stepsDoneAfter: 2,
    stepsTotal: 7,
    session: 'cse_01V1aoCMYL7Ckkar3cKSLtFf',
    createdAt: '2026-10-07T18:00:00Z',
  },
  {
    id: 'update-1',
    featureId: 'feat',
    health: 'on_track',
    body: 'The levels have their names and the shared tabbed detail layout is built. The feature page is next.',
    stepsDoneBefore: 0,
    stepsDoneAfter: 1,
    stepsTotal: 7,
    session: 'cse_01V1aoCMYL7Ckkar3cKSLtFf',
    createdAt: '2026-10-07T09:05:00Z',
  },
];

/**
 * What the Activity tab reads beyond the plan (plan #1667): the block on the
 * goal page step, two runs, one of which did not finish, and what Dash
 * recorded doing: closing the layout step, which marks that entry as Dash's,
 * and raising the feature's priority, which is listed on its own.
 */
const featureActivitySources = {
  blockedAt: { 'feat-goal': '2026-10-07T11:40:00Z' },
  runs: [
    {
      id: 'run-1',
      stepId: 'feat-layout',
      job: 'step' as const,
      status: 'finished' as const,
      error: null,
      createdAt: '2026-10-07T07:58:00Z',
    },
    {
      id: 'run-2',
      stepId: 'feat-goal',
      job: 'step' as const,
      status: 'failed' as const,
      error: 'The session ended without closing the step.',
      createdAt: '2026-10-07T10:29:00Z',
    },
  ],
  actions: [
    {
      id: 'act-1',
      stepId: 'feat-layout',
      kind: 'close_step',
      summary: 'Dash closed step #3, "Build the shared tabbed detail layout".',
      createdAt: '2026-10-07T09:00:02Z',
    },
    {
      id: 'act-2',
      stepId: 'feat',
      kind: 'set_priority',
      summary: 'Dash raised the priority of the feature page to high, since three steps wait on it.',
      createdAt: '2026-10-07T12:15:00Z',
    },
  ],
};

function FeatureFixture({ editing = false }: { editing?: boolean }) {
  if (!featureSection || !featureNode) return null;
  return (
    <FeaturePage
      startEditing={editing}
      feature={featureNode}
      module="dev"
      moduleLabel={featureSection.label}
      catalog={catalogOf(featureTree)}
      canSend
      lastRuns={{}}
      updates={featureUpdates}
      activity={featureActivitySources}
      commitChecks={{
        '79074ffd': {
          mergeSha: '79074ffd',
          conclusion: 'passed',
          checkedAt: '2026-10-07T09:30:00Z',
        },
      }}
    />
  );
}

/** The feature page on its Overview tab. */
export function PlanFeatureSurface() {
  return <FeatureFixture />;
}

/** The same page on its Activity tab: what happened, newest first (plan #1667). */
export function PlanFeatureActivitySurface() {
  return (
    <>
      <SetTab tab="activity" />
      <FeatureFixture />
    </>
  );
}

/** The same page on its Steps tab: the feature's steps grouped by status. */
export function PlanFeatureStepsSurface() {
  return (
    <>
      <SetTab tab="steps" />
      <FeatureFixture />
    </>
  );
}

const HELD_YOURS = { held: 'me' };

/** The Steps tab after a press on "Yours" in the properties (plan #1668). */
export function PlanFeatureStepsYoursSurface() {
  return (
    <>
      <SetTab tab="steps" params={HELD_YOURS} />
      <FeatureFixture />
    </>
  );
}

/** The feature page's Edit: the compose surface it was written in, filled in (plan #1670). */
export function PlanFeatureEditSurface() {
  return <FeatureFixture editing />;
}

/**
 * The "New feature" surface open at the top of the plan (plan #1670): title,
 * summary, the module and property chips, then the description.
 */
export function PlanNewFeatureSurface() {
  return (
    <PlanView
      sections={applyView(whole, 'open')}
      finished={[]}
      summary={summarize(whole)}
      view="open"
      catalog={catalog}
      empty={false}
      canSend={false}
      lastRuns={treeRuns}
      commitChecks={{}}
      newFeature={{ open: true }}
    />
  );
}
