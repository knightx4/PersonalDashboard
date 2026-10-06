/**
 * Starting the overhaul routine from an overhaul's row (plan #1514,
 * docs/SPEC-LAYER-SPEC.md Part 4).
 *
 * An overhaul is a feature with `track = 'overhaul'`. The overnight runner
 * never takes one; the overhaul routine works it instead, with the standing
 * prompt in .claude/skills/plan/reference/overhaul-routine.md. That prompt
 * expects the turn after it to name the overhaul by number, the account's
 * user_id and the overhaul's brief, and this file writes that turn and says
 * when the press is refused.
 *
 * Pure, so the rules are tested without a database or a routine.
 * `app/dev/plan/actions.ts` does the reads and the fire.
 */
import { isClosed } from './load';
import type { PlanNode } from './tree';

/** The routine as the deployment has it: which of the two values are set. */
export type OverhaulRoutineState = { id: boolean; token: boolean };

/**
 * Why the press cannot start a run, or null when it can.
 *
 * `latest` is the newest run recorded against the row, of any job. A run
 * still going against it is refused, whichever press started it, because two
 * sessions working the same steps is the collision the plan's claims exist to
 * stop.
 */
export function overhaulRefusal(
  node: Pick<PlanNode, 'number' | 'track' | 'status'>,
  routine: OverhaulRoutineState,
  latest: { status: string; job: string } | null | undefined,
): string | null {
  if (node.track !== 'overhaul') {
    return `#${node.number} is not an overhaul, so the overhaul routine has nothing to work there.`;
  }
  if (node.status === 'proposed') {
    return `#${node.number} is only a proposal. Approve it before starting the overhaul.`;
  }
  if (isClosed(node.status)) {
    return `#${node.number} is ${node.status}, so there is nothing left to work.`;
  }
  if (!routine.id || !routine.token) {
    const missing = [
      routine.id ? null : 'CLAUDE_OVERHAUL_ROUTINE_ID',
      routine.token ? null : 'CLAUDE_OVERHAUL_ROUTINE_TOKEN',
    ].filter(Boolean);
    return `The overhaul routine is not set up on the deployment. Set ${missing.join(' and ')} in Vercel.`;
  }
  if (latest?.status === 'started') {
    return latest.job === 'overhaul'
      ? `An overhaul run is already working #${node.number}. Wait for it to finish.`
      : `A run is already working #${node.number}. Wait for it to finish before starting the overhaul.`;
  }
  return null;
}

/**
 * The turn appended to the routine's session: the overhaul by number and
 * title, the account, and the brief as the plan holds it now.
 */
export function overhaulTurn(
  node: Pick<PlanNode, 'number' | 'title'>,
  userId: string,
  brief: string,
): string {
  return (
    `Work overhaul #${node.number}, "${node.title}".\n` +
    `user_id: ${userId}\n\n` +
    'The brief is below. It is the plan as the app holds it right now, and the plan is ' +
    'the source of truth. "Decided so far" is every answer settled beneath this overhaul.\n\n' +
    brief
  );
}
