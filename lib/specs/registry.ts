import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MODULES, type ModuleId } from '@/lib/modules';

/**
 * Which documents are specifications, and where each one lives.
 *
 * An explicit list rather than a glob over `docs/`. Half of that directory is
 * working notes -- a handoff, a latency investigation, a consent tally -- and a
 * page that lists everything would bury the four documents somebody actually
 * reviews. Adding a spec here is a deliberate act, which is the right weight
 * for it.
 *
 * The blurb is what the list page shows. It is written here rather than pulled
 * from the document's first paragraph because those open by stating a problem,
 * and "Every learning tool starts knowing nothing about you" is a fine opening
 * line and a useless list entry.
 */

export type SpecDoc = {
  slug: string;
  title: string;
  blurb: string;
  file: string;
  /** The workspace it describes, or null for the app as a whole. */
  module: ModuleId | null;
};

export const SPECS: readonly SpecDoc[] = [
  {
    slug: 'writing',
    title: 'Professional writing guide',
    blurb:
      'The standard every document here is written to: what to reward, what to penalize, and the four failure modes that produce AI slop.',
    file: 'WRITING-GUIDE.md',
    module: null,
  },
  {
    slug: 'ui-quality',
    title: 'Checking screens while they are built',
    blurb:
      'Every new or changed screen is drawn in the gallery first, photographed at phone width, and passed by a separate design critic before it merges, with your own preferences written down where the critic reads them.',
    file: 'UI-QUALITY-SPEC.md',
    module: null,
  },
  {
    slug: 'spec-layer',
    title: 'Specs as the layer you work at',
    blurb:
      'Rules in every spec that the gate checks, a weekly audit that compares the code with the specs and proposes changes, spec changes you approve in place of features, and overhauls built in their own order.',
    file: 'SPEC-LAYER-SPEC.md',
    module: null,
  },
  {
    slug: 'core-and-dash',
    title: 'One core and one Dash',
    blurb:
      'One way to point at a row, one thread on any row, one whose-move label, one list of what is on you, one record of what Dash did, and one Dash working through all of them.',
    file: 'CORE-AND-DASH-SPEC.md',
    module: null,
  },
  {
    slug: 'cut-back',
    title: 'Cutting back',
    blurb:
      'Record which pages are opened, cut each workspace to the screens that are used, starting with Learn, and slow the build loop while that happens.',
    file: 'CUT-BACK-SPEC.md',
    module: null,
  },
  {
    slug: 'knowledge',
    title: 'The vault map',
    blurb:
      'The foundation under the vault and both learn specs: a map of what you write about, derived from the notes and never written back, and the rule that it says what you are interested in rather than what you know.',
    file: 'KNOWLEDGE-SPEC.md',
    // Filed under vault: the map it specifies is derived from the notes and
    // belongs to that module. It also governs what Learn may assume from the
    // map, and all three learn specs point here for the decisions that moved.
    module: 'vault',
  },
  {
    slug: 'learn-sources',
    title: 'Learn: where to go learn it',
    blurb:
      'A shared catalogue of Wikipedia sections and lecture segments, embedded and matched to a claim, so a subject you never wrote a note about still has material.',
    file: 'LEARN-SOURCES-SPEC.md',
    module: 'learn',
  },
  {
    slug: 'learn-map',
    title: 'The map',
    blurb:
      'What a node is, what the six edge types mean, what happens when two of them disagree, and the procedure that turns the vault into a knowledge map.',
    file: 'LEARN-MAP-SPEC.md',
    module: 'learn',
  },
  {
    slug: 'learn-levels',
    title: 'Learn: topics and levels',
    blurb:
      'One shared map of topics, ten fixed levels on each, and the rule that showing a level shows what it rests on: how Learn records what you know and picks what is next.',
    file: 'LEARN-LEVELS-SPEC.md',
    module: 'learn',
  },
  {
    slug: 'learn-graph',
    title: 'Learn: what you know',
    blurb:
      'The second half of the learn module. Subjects and goals, probing the edge, misconceptions, and a progress bar that tells the truth.',
    file: 'LEARN-GRAPH-SPEC.md',
    module: 'learn',
  },
  {
    slug: 'learn',
    title: 'Learn: the reading queue',
    blurb:
      'A list of things somebody told you to read, turned into a queue you can start: every item resolved to a link that opens, pointed at the part worth reading.',
    file: 'LEARN-SPEC.md',
    module: 'learn',
  },
  {
    slug: 'plan',
    title: 'The plan',
    blurb:
      'How /dev/plan works: the tree of features and steps, what a session may and may not do to it, and how decisions and fog are recorded.',
    file: 'PLAN-SPEC.md',
    module: 'dev',
  },
  {
    slug: 'x-posts',
    title: 'Writing X posts about the app',
    blurb:
      'What a post about how the app is built should say, what the plan has to back, what never goes in one, and six examples from shipped steps. The posts run drafts to it.',
    file: 'X-POSTS.md',
    module: 'dev',
  },
  {
    slug: 'vault',
    title: 'The vault',
    blurb: 'The Obsidian mirror: one-way sync, markdown only, and what it is eventually for.',
    file: 'VAULT-SPEC.md',
    module: 'vault',
  },
  {
    slug: 'todo',
    title: 'Todo',
    blurb: 'The list you typed, the sources that feed it, and why the agenda is derived.',
    file: 'TODO-SPEC.md',
    module: 'todo',
  },
  {
    slug: 'job-search',
    title: 'Job search',
    blurb: 'The job side, end to end.',
    file: 'JOB-SEARCH-SPEC.md',
    module: 'jobs',
  },
  {
    slug: 'evidence-layer',
    title: 'The evidence layer',
    blurb: 'Things you can demonstrate, and the drafting that cites them.',
    file: 'EVIDENCE-LAYER.md',
    module: 'jobs',
  },
  {
    slug: 'share-links',
    title: 'Share links',
    blurb: 'Anonymous pages that expire on schedule.',
    file: 'SHARE-LINKS-SPEC.md',
    module: null,
  },
  {
    slug: 'build-order',
    title: 'The build order',
    blurb: 'Every module, in the order it was built, and the argument for that order.',
    file: 'BUILD-ORDER.md',
    module: null,
  },
];

export function specBySlug(slug: string): SpecDoc | null {
  return SPECS.find((spec) => spec.slug === slug) ?? null;
}

/**
 * The document's text, read from the repository at request time.
 *
 * `next.config.ts` forces `docs/` into the output trace, because nothing
 * imports these files and the tracer would otherwise be right to leave them
 * out. Missing is a real outcome rather than a crash: a spec renamed in the
 * repository should leave the page saying so, with its comments intact, not a
 * 500.
 */
export async function readSpec(spec: SpecDoc): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), 'docs', spec.file), 'utf8');
  } catch {
    return null;
  }
}

/** One workspace's specs, with the counts the folded row shows. */
export type SpecGroup = {
  module: ModuleId | null;
  label: string;
  specs: SpecDoc[];
  comments: number;
};

/**
 * The specs, grouped by the workspace they describe.
 *
 * Module order follows `MODULES`, with the app-wide group last, which is the
 * order `/dev/plan` and `/dev/ideas` already use.
 *
 * Every workspace gets a group, whether or not a document has been written for
 * it, because the group is also where its vision is written and a workspace
 * nobody has specified yet is exactly the one that wants one. The app-wide
 * group is kept on the same terms: the vision for the app as a whole is
 * written at its head.
 *
 * Pure, and it takes the comment counts rather than reading them, so the
 * grouping and the numbers on the folded rows can be tested without a database.
 */
export function groupSpecs(
  specs: readonly SpecDoc[],
  counts: Record<string, number> = {},
): SpecGroup[] {
  const scopes: Array<ModuleId | null> = [...MODULES.map((module) => module.id), null];

  return scopes.map((scope) => {
    const mine = specs.filter((spec) => spec.module === scope);
    return {
      module: scope,
      label: scope
        ? (MODULES.find((module) => module.id === scope)?.label ?? scope)
        : 'The app as a whole',
      specs: mine,
      comments: mine.reduce((total, spec) => total + (counts[spec.slug] ?? 0), 0),
    };
  });
}
