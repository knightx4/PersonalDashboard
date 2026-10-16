import type { Territory, TerritoryTopic } from '@/lib/learn/levels/territory';
import type { PreparationStepKey } from './steps';

/**
 * A direction to go deeper (plan #2276.7).
 *
 * The first preparation lays out the whole territory at high level. Once the
 * person has answered DIRECTION_ANSWERS graded questions on the subject's
 * lens, the page offers two to four branches of it: the territory's topics
 * grouped by the frame topic they refine, the largest groups first. Picking
 * one raises the targets under it and opens a run for that branch alone
 * (learn 0171), which pulls and matches documents for the branch, lays out
 * the deeper topics beneath it, drafts them onto the same lens and finishes.
 * The offer, picked or dismissed, comes back after another DIRECTION_ANSWERS.
 *
 * Pure: the page, the presses and the runner's handlers read it.
 */

/** Graded answers on the subject's lens before the offer is made, and between offers. */
export const DIRECTION_ANSWERS = 30;
/** Branches the offer lists at most and, when the territory has them, at least. */
export const MAX_BRANCHES = 4;
export const MIN_BRANCHES = 2;
/** Topics a branch must hold to be offered: one topic is not a direction. */
export const MIN_BRANCH_TOPICS = 2;
/** Topic names shown under a branch as what it leads to. */
export const LEADS_TO_SHOWN = 3;

/**
 * The steps a branch run is opened with, at their places in PREPARATION_STEPS.
 * classify and write_units belong to the subject's own run. The same list is
 * in learn.choose_subject_direction (0171); branch.test.ts holds them equal.
 */
export const BRANCH_STEPS: readonly PreparationStepKey[] = [
  'pull_documents',
  'match_weeks',
  'compile_territory',
  'draft_topics',
  'finish',
];

/** A branch as a run stores it on learn.subject_preparations.branch. */
export type PreparationBranch = {
  /** Stable within a subject: the frame title, lower-cased and hyphened. */
  key: string;
  /** The Level 4 frame topic the branch's topics refine. */
  frame: string;
  /** What the page calls it: the frame title. */
  name: string;
  /** The asks of the territory topics under it, as the subject's run laid them out. */
  asks: string[];
};

/** A branch as the offer lists it. */
export type DirectionBranch = PreparationBranch & {
  /** The first few topic asks under it, in territory order: what it leads to. */
  leadsTo: string[];
  /** How many topics of the territory sit under it. */
  topics: number;
};

/** The last answer to the offer, as learn.subject_preparations.direction holds it. */
export type DirectionChoice =
  | { state: 'picked'; key: string; name: string; answers: number; at: string }
  | { state: 'dismissed'; answers: number; at: string };

export function branchKey(frame: string): string {
  return (
    frame
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'branch'
  );
}

/**
 * The territory's branches, largest first: topics grouped by frame, groups
 * of fewer than MIN_BRANCH_TOPICS left out, ties in the order the territory
 * first meets them. Every branch, not only the ones offered.
 */
export function territoryBranches(territory: Pick<Territory, 'topics'>): DirectionBranch[] {
  const byFrame = new Map<string, { first: number; topics: TerritoryTopic[] }>();
  territory.topics.forEach((topic, i) => {
    const frame = topic.frame.trim();
    if (!frame) return;
    const had = byFrame.get(frame) ?? { first: i, topics: [] };
    had.topics.push(topic);
    byFrame.set(frame, had);
  });
  return [...byFrame.entries()]
    .filter(([, g]) => g.topics.length >= MIN_BRANCH_TOPICS)
    .sort((a, b) => b[1].topics.length - a[1].topics.length || a[1].first - b[1].first)
    .map(([frame, g]) => ({
      key: branchKey(frame),
      frame,
      name: frame,
      asks: g.topics.map((t) => t.ask),
      leadsTo: g.topics.slice(0, LEADS_TO_SHOWN).map((t) => t.ask),
      topics: g.topics.length,
    }));
}

export function readDirection(value: unknown): DirectionChoice | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  const answers = typeof d.answers === 'number' && Number.isFinite(d.answers) ? d.answers : 0;
  const at = typeof d.at === 'string' ? d.at : '';
  if (d.state === 'dismissed') return { state: 'dismissed', answers, at };
  if (d.state === 'picked' && typeof d.key === 'string') {
    return { state: 'picked', key: d.key, name: typeof d.name === 'string' ? d.name : d.key, answers, at };
  }
  return null;
}

export function readBranch(value: unknown): PreparationBranch | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  if (typeof b.key !== 'string' || !b.key || typeof b.frame !== 'string') return null;
  const asks = Array.isArray(b.asks) ? b.asks.filter((a): a is string => typeof a === 'string') : [];
  return { key: b.key, frame: b.frame, name: typeof b.name === 'string' ? b.name : b.frame, asks };
}

export type DirectionOffer = {
  answers: number;
  branches: DirectionBranch[];
};

/**
 * The offer, or null when it is not due. Due once the lens has
 * DIRECTION_ANSWERS graded answers, and again DIRECTION_ANSWERS after the
 * last pick or dismissal. Branches already prepared, or being prepared, are
 * not offered again; fewer than MIN_BRANCHES left means no offer.
 */
export function directionOffer(input: {
  answers: number;
  direction: DirectionChoice | null;
  territory: Pick<Territory, 'topics'> | null;
  /** Keys of the subject's branch runs, whatever their state. */
  taken: ReadonlySet<string>;
  /** False while the subject's own run is unfinished: the offer waits for it. */
  prepared: boolean;
}): DirectionOffer | null {
  if (!input.prepared || !input.territory) return null;
  const since = input.direction ? input.direction.answers : 0;
  if (input.answers - since < DIRECTION_ANSWERS) return null;
  const branches = territoryBranches(input.territory)
    .filter((b) => !input.taken.has(b.key))
    .slice(0, MAX_BRANCHES);
  if (branches.length < MIN_BRANCHES) return null;
  return { answers: input.answers, branches };
}

/** What a branch run stores: the branch without what only the offer shows. */
export function storedBranch(branch: DirectionBranch): PreparationBranch {
  return { key: branch.key, frame: branch.frame, name: branch.name, asks: [...branch.asks] };
}

/**
 * The subject as a branch run's searches read it: the subject's name with the
 * branch after it, and a note saying which topics are already laid out, so
 * the pull, the match and the compile all aim beneath the branch.
 */
export function searchSubject(subject: {
  name: string;
  note: string | null;
  branch?: PreparationBranch | null;
}): { name: string; note: string | null } {
  const branch = subject.branch;
  if (!branch) return { name: subject.name, note: subject.note };
  const known = branch.asks.slice(0, 12).join('; ');
  const note = [
    subject.note?.trim() || null,
    `Going deeper on ${branch.name}.`,
    known ? `Already laid out at high level: ${known}.` : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' ');
  return { name: `${subject.name.trim()}: ${branch.name}`, note };
}
