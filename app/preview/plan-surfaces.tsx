import { PageHeader } from '@/components/shell/page-header';
import { projectById } from '@/lib/plan/projects';
import { PlanView, type PlanCatalogEntry } from '@/app/dev/plan/plan-view';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import type { CriticStopView } from '@/lib/plan/ui-check-stop';
import {
  applyView,
  buildPlanTree,
  flattenSections,
  summarize,
  type PlanSection,
} from '@/lib/plan/tree';

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

function catalogOf(tree: PlanSection[]): PlanCatalogEntry[] {
  return flattenSections(tree).map((node) => ({
    id: node.id,
    number: node.number,
    outline: node.outline,
    title: node.title,
    module: node.module,
    parentId: node.parentId,
    depth: node.depth,
    status: node.status,
    completedAt: node.completedAt,
    closed: node.status === 'done' || node.status === 'dropped',
  }));
}

const catalog = catalogOf(whole);

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
      lastRuns={{}}
      commitChecks={{}}
      unfolded
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
      nodes: section.nodes.filter((node) => node.id === 'stuck' || node.id === 'goal-tree'),
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
            change: 'Put the company and role on one line and fold the conversation to its first line.',
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
