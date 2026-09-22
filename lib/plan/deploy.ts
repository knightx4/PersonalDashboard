/**
 * Whether main's newest commit is what the site is running.
 *
 * Vercel records every production deploy on GitHub as a deployment against
 * the commit it built, and updates that deployment's status as it goes. The
 * overnight tick (`lib/plan/ci.ts` `refreshMainCheck`) reads the newest status
 * for main's head, and this file turns it into one of four words. Pure, like
 * `checks.ts`, because the dot that draws it is drawn in the browser.
 */

/** What the status line says about main's deploy. */
export type DeployState = 'deployed' | 'deploying' | 'failed' | 'missing';

/**
 * How long a commit may sit on main with no deployment before that is a fault.
 *
 * Vercel records a deployment within a minute of the push, so a few minutes
 * with none is normal and fifteen is not. Until then the reading is
 * `deploying`, which is what is happening from the outside.
 */
export const DEPLOY_GRACE_MINUTES = 15;

/**
 * The word for main's head, from the newest status of its production
 * deployment (null when GitHub has no deployment for the commit) and when the
 * commit was made.
 *
 * `inactive` counts as deployed: GitHub sets it on a deployment that a newer
 * one replaced, and a replaced deploy of this same commit still went out.
 * `error` is Vercel's word for a build that could not run at all, and to the
 * person reading the dot that is a failed deploy like any other.
 */
export function deployStateFrom(input: {
  status: string | null;
  committedAt: string | null;
  now: number;
}): DeployState {
  switch (input.status) {
    case 'success':
    case 'inactive':
      return 'deployed';
    case 'failure':
    case 'error':
      return 'failed';
    case null:
      break;
    default:
      // queued, pending, in_progress, and anything GitHub adds later.
      return 'deploying';
  }

  const at = input.committedAt ? new Date(input.committedAt).getTime() : Number.NaN;
  // A commit whose age is unknown gets the benefit of the doubt for one tick
  // after another; the dot then says "deploying", which is not a claim that
  // anything is wrong or right.
  if (!Number.isFinite(at)) return 'deploying';
  return (input.now - at) / 60_000 >= DEPLOY_GRACE_MINUTES ? 'missing' : 'deploying';
}

/** The panel's line for each state. */
export const DEPLOY_SAYS: Record<DeployState, string> = {
  deployed: 'Deployed to production.',
  deploying: 'Deploying to production.',
  failed: 'The production deploy failed, so the site is still running an older commit.',
  missing: `No production deploy has started, ${DEPLOY_GRACE_MINUTES} minutes or more after the commit. Vercel may not have picked it up.`,
};
