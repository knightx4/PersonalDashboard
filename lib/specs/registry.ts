import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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
};

export const SPECS: readonly SpecDoc[] = [
  {
    slug: 'learn-map',
    title: 'The map',
    blurb:
      'What a node is, what the six edge types mean, what happens when two of them disagree, and the procedure that turns the vault into a knowledge map.',
    file: 'LEARN-MAP-SPEC.md',
  },
  {
    slug: 'learn-graph',
    title: 'Learn: what you know',
    blurb:
      'The second half of the learn module. Subjects and goals, probing the edge, misconceptions, and a progress bar that tells the truth.',
    file: 'LEARN-GRAPH-SPEC.md',
  },
  {
    slug: 'learn',
    title: 'Learn: the reading queue',
    blurb:
      'A list of things somebody told you to read, turned into a queue you can start: every item resolved to a link that opens, pointed at the part worth reading.',
    file: 'LEARN-SPEC.md',
  },
  {
    slug: 'plan',
    title: 'The plan',
    blurb:
      'How /dev/plan works: the tree of features and steps, what a session may and may not do to it, and how decisions and fog are recorded.',
    file: 'PLAN-SPEC.md',
  },
  {
    slug: 'vault',
    title: 'The vault',
    blurb: 'The Obsidian mirror: one-way sync, markdown only, and what it is eventually for.',
    file: 'VAULT-SPEC.md',
  },
  {
    slug: 'todo',
    title: 'Todo',
    blurb: 'The list you typed, the sources that feed it, and why the agenda is derived.',
    file: 'TODO-SPEC.md',
  },
  {
    slug: 'job-search',
    title: 'Job search',
    blurb: 'The job side, end to end.',
    file: 'JOB-SEARCH-SPEC.md',
  },
  {
    slug: 'evidence-layer',
    title: 'The evidence layer',
    blurb: 'Things you can demonstrate, and the drafting that cites them.',
    file: 'EVIDENCE-LAYER.md',
  },
  {
    slug: 'share-links',
    title: 'Share links',
    blurb: 'Anonymous pages that expire on schedule.',
    file: 'SHARE-LINKS-SPEC.md',
  },
  {
    slug: 'build-order',
    title: 'The build order',
    blurb: 'Every module, in the order it was built, and the argument for that order.',
    file: 'BUILD-ORDER.md',
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
