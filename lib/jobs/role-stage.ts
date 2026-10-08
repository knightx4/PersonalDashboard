/**
 * Where a pursuit is, as the role page reads it (plan #1594).
 *
 * The page opens on the tab that stage needs and offers only the controls
 * that fit it. A closed application leads with how far it got and when it
 * closed, and folds away drafting, prep and adding a round.
 */
import { isTerminal, statusRank, type ApplicationStatus } from './pipeline';
import { statusLabel } from './status-label';

export type RoleStage = 'lead' | 'applied' | 'interviewing' | 'closed';

export function roleStage(status: ApplicationStatus): RoleStage {
  if (isTerminal(status)) return 'closed';
  if (status === 'lead' || status === 'drafting') return 'lead';
  if (statusRank(status) >= statusRank('in_process')) return 'interviewing';
  return 'applied';
}

/**
 * One sentence on a closed application: how it ended, when, and the furthest
 * it got. `closedOn` is the day already formatted for the reader, or null
 * when the record does not say.
 */
export function closedSummary(input: {
  status: ApplicationStatus;
  /** The highest rung it ever reached (highWaterFromRejectionStage). */
  reached: ApplicationStatus;
  everSubmitted: boolean;
  closedOn: string | null;
  interviewCount: number;
}): string {
  const ended = statusLabel(input.status, input.everSubmitted);
  const when = input.closedOn ? ` on ${input.closedOn}` : '';
  return `${ended}${when}, ${howFar(input)}.`;
}

function howFar({
  reached,
  everSubmitted,
  interviewCount,
}: {
  reached: ApplicationStatus;
  everSubmitted: boolean;
  interviewCount: number;
}): string {
  const rounds = interviewCount === 1 ? 'one interview' : `${interviewCount} interviews`;
  if (statusRank(reached) >= statusRank('offer')) return 'after an offer';
  if (statusRank(reached) >= statusRank('final_round')) {
    return interviewCount > 0
      ? `after reaching the final round, ${rounds} in`
      : 'after reaching the final round';
  }
  if (statusRank(reached) >= statusRank('in_process') || interviewCount > 0) {
    return interviewCount > 0 ? `after ${rounds}` : 'after a reply from a person';
  }
  if (!everSubmitted) return 'before an application went in';
  return 'with no reply from a person before it closed';
}
