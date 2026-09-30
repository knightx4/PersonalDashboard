import type { MainCheck } from './main-check';

/**
 * The "Fix with Dash" press on the CI panel (note 06016ffa).
 *
 * When main is red, the panel behind the status line's dot offers one button
 * that starts the plan routine on getting main green. Pure, so the brief and
 * the rule about a second press are testable without a routine or a database.
 */

/**
 * How long one press holds the button off. A fix takes a merge, the gate and
 * a CI run, and a second session sent at the same failure only races the
 * first to main (the raises about two runs on #342 and #608 were that shape).
 */
export const CI_FIX_HOLD_MS = 60 * 60 * 1000;

/** Whether a fix run started recently enough that another would race it. */
export function ciFixRunning(startedAt: readonly string[], now: number): boolean {
  return startedAt.some((at) => now - new Date(at).getTime() < CI_FIX_HOLD_MS);
}

/** What the session is told: what failed, where to read it, and how to land the fix. */
export function ciFixText(check: Pick<MainCheck, 'sha' | 'reason' | 'runUrl'>): string {
  const lines = [
    'CI on main is red. Get it green again.',
    '',
    `Main's head: ${check.sha ?? 'not read'}.`,
    `What failed: ${check.reason ?? 'the failing jobs could not be read; open the run to see them.'}`,
    `The run: ${check.runUrl ?? 'no link was recorded; list the latest workflow runs on main.'}`,
    '',
    'Read the failing job logs and find the actual cause before changing anything. ' +
      'Make the smallest change that fixes it on its own branch, merge origin/main in, ' +
      'run `npm run gate`, and push to main only once it ends with `gate: all clear` ' +
      '(CLAUDE.md, "Run the gate before pushing to main"). Never skip, disable or ' +
      'quarantine a test to get green. If the cause is outside the repository, a ' +
      'secret or a service that is down, file a raise saying what is needed instead.',
  ];
  return lines.join('\n');
}
