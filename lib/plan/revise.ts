/**
 * Rewriting a step that has not started yet, because of what building an
 * earlier step under the same feature found.
 *
 * Shaping writes a feature's steps before anything is built, and building
 * the first one often shows that a later one was written against a guess:
 * the data has a different shape, a helper already exists, a page the step
 * meant to add is already there. Before this, nothing could say so. The
 * builder that found it was told not to touch other steps, a re-shape only
 * read answers to decisions, and the next builder got a done-when the batch
 * already knew was wrong.
 *
 * `plan.ts revise` lets the session running the batch fix that, within the
 * approval the person gave. These are the limits, kept here so they can be
 * tested and so the CLI and any later caller refuse the same things.
 */

import { buildStamp } from './origin';

/** The parts of a row the rules read. */
export type ReviseTarget = {
  kind: string;
  status: string;
  /** Null for a top-level feature. */
  parent_id: string | null;
  title: string;
  acceptance: string | null;
  detail: string | null;
  comment: string | null;
};

export type ReviseSource = {
  kind: string;
  status: string;
  commit_sha: string | null;
};

export type ReviseChange = {
  title?: string | null;
  detail?: string | null;
  doneWhen?: string | null;
};

/**
 * Why a revise cannot go ahead, or null when it can.
 *
 * - Only a build step that has not started. A step in progress belongs to the
 *   builder working it, a blocked one is waiting on a question that the
 *   revise would answer by the back door, and a closed one is history.
 * - Never a top-level feature. Its done-when is the destination the person
 *   approved; changing that is a decision for them.
 * - Only from a step that has been built (done, or in progress with the
 *   commit a `built` recorded). A guess about what a step will find is not a
 *   finding.
 * - Both in the same feature. What one feature's step found is a reason to
 *   raise something about another feature, not to rewrite it.
 */
export function reviseRefusal(input: {
  target: ReviseTarget;
  targetRef: string;
  source: ReviseSource;
  sourceRef: string;
  sameFeature: boolean;
  change: ReviseChange;
  finding: string | null | undefined;
}): string | null {
  const { target, targetRef, source, sourceRef, change } = input;
  if (target.parent_id === null) {
    return (
      `${targetRef} is a feature: its done-when is what the person approved. ` +
      `If what was built changes where the feature ends up, ask with ` +
      `add "…?" --parent ${targetRef} --kind decision.`
    );
  }
  if (target.kind !== 'build') {
    return `${targetRef} is a ${target.kind}, not a build step. Only build steps are revised.`;
  }
  if (target.status !== 'not_started' && target.status !== 'proposed') {
    return (
      `${targetRef} is ${target.status.replace('_', ' ')}. Only a step nobody has started ` +
      `is revised: one in progress is its builder's, a blocked one waits on its question, ` +
      `and a closed one is history.`
    );
  }
  if (source.kind !== 'build') {
    return `${sourceRef} is a ${source.kind}. A decision's answer goes through a re-shape (add --from).`;
  }
  const built = source.status === 'done' || (source.status === 'in_progress' && source.commit_sha);
  if (!built) {
    return `${sourceRef} has not been built yet. Revise from what a built step found, not from a guess.`;
  }
  if (!input.sameFeature) {
    return (
      `${sourceRef} and ${targetRef} are under different features. What one found about ` +
      `another feature is an idea or a raise, not a revise.`
    );
  }
  if (!input.finding?.trim()) {
    return `Say what ${sourceRef} found with --because "…": the person reads it on the row.`;
  }
  const changed = (['title', 'detail', 'doneWhen'] as const).filter(
    (key) => change[key] !== undefined && change[key] !== null,
  );
  if (changed.length === 0) {
    return 'Give at least one of --title, --detail or --done-when.';
  }
  return null;
}

/**
 * The comment after a revise: the stamp naming what caused it, then what the
 * row said before, so the person can see the change and put it back.
 */
export function revisedComment(input: {
  comment: string | null;
  target: ReviseTarget;
  change: ReviseChange;
  sourceOutline: string;
  finding: string;
  date: string;
}): string {
  const { target, change } = input;
  const was: string[] = [];
  if (change.title != null && change.title !== target.title) {
    was.push(`Title was: ${target.title}`);
  }
  if (change.doneWhen != null && change.doneWhen !== target.acceptance) {
    was.push(`Done-when was: ${target.acceptance ?? '(none)'}`);
  }
  if (change.detail != null && change.detail !== target.detail) {
    was.push(`Detail was: ${target.detail ?? '(none)'}`);
  }
  const lines = [
    buildStamp(input.sourceOutline, input.finding),
    `Revised ${input.date} by the batch building this feature.`,
    ...was,
  ];
  const block = lines.join('\n');
  return input.comment ? `${input.comment}\n\n${block}` : block;
}
