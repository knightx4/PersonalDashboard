import type { Move } from '@/lib/core/move';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { applicationMove } from '@/lib/jobs/move';
import { isLive, statusRank, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { statusLabel } from '@/lib/jobs/status-label';

/**
 * Every live application on Today, grouped by whose move it is (plan #1591).
 *
 * Live is the Pipeline's rule (`isLive`: not closed, leads included), so the
 * count here is the count on Pipeline's footer. The move is the board's rule
 * (`applicationMove`, lib/jobs/move.ts), with one thing the board cannot see:
 * mail on the application that asked you something and is still waiting on
 * This week makes it yours. One rule, so a role is never "waiting" in one
 * list and "on you" in the next.
 *
 * Three groups. Sent applications whose move is yours come first, since a
 * reply you owe is what goes stale. Then the ones waiting on the company. Then
 * the leads and drafts: their move is yours too, but they are roles you are
 * still deciding about, and twenty of them on top would bury the replies.
 *
 * Pure.
 */

export interface LiveApplication {
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  /** The stage, in the words the role page uses. */
  stage: string;
  move: Move;
  /** Why the move is where it is, in the pipeline's own terms. */
  why: string;
  /** What the move on you is, in a few words, or null when it is not yours. */
  todo: string | null;
  daysSinceActivity: number | null;
}

export interface LiveByMove {
  onYou: LiveApplication[];
  waiting: LiveApplication[];
  unsent: LiveApplication[];
  /** Every live application: the three groups together, and Pipeline's live count. */
  total: number;
}

const UNSENT: readonly ApplicationStatus[] = ['lead', 'drafting'];

/** The move on you in a few words, for a row with one line to say it in. */
function todoOf(row: PipelineRow, asked: boolean): string {
  if (row.status === 'offer') return 'Answer the offer';
  switch (row.lastTurnEvent) {
    case 'recruiter_reply':
      return 'Reply to them';
    case 'assessment_sent':
      return 'Do the assessment';
    case 'screen_scheduled':
    case 'interview_scheduled':
      return 'Prepare for the interview';
  }
  return asked ? 'Answer their email' : 'Your move';
}

/** Furthest along first, then the one that moved most recently. */
function byStageThenRecent(a: LiveApplication, b: LiveApplication): number {
  const stage = statusRank(b.status) - statusRank(a.status);
  if (stage !== 0) return stage;
  return (a.daysSinceActivity ?? Infinity) - (b.daysSinceActivity ?? Infinity);
}

export function liveByMove(
  rows: readonly PipelineRow[],
  askedApplicationIds: ReadonlySet<string> = new Set(),
): LiveByMove {
  const onYou: LiveApplication[] = [];
  const waiting: LiveApplication[] = [];
  const unsent: LiveApplication[] = [];

  for (const row of rows) {
    if (!isLive(row.status)) continue;
    const result = applicationMove({
      status: row.status,
      lastEvent: row.lastTurnEvent,
      companyName: row.companyName,
      asked: askedApplicationIds.has(row.applicationId),
    });
    if (!result) continue;
    const asked = askedApplicationIds.has(row.applicationId);
    const live: LiveApplication = {
      applicationId: row.applicationId,
      roleId: row.roleId,
      companyName: row.companyName,
      roleTitle: row.roleTitle,
      status: row.status,
      stage: statusLabel(row.status),
      move: result.move,
      why: result.title,
      // A lead's move is always the same one, so its row says only its stage.
      todo:
        result.move.state === 'on_you' && !UNSENT.includes(row.status) ? todoOf(row, asked) : null,
      daysSinceActivity: row.daysSinceActivity,
    };
    if (UNSENT.includes(row.status)) unsent.push(live);
    else if (result.move.state === 'on_you') onYou.push(live);
    else waiting.push(live);
  }

  onYou.sort(byStageThenRecent);
  waiting.sort(byStageThenRecent);
  unsent.sort(byStageThenRecent);
  return { onYou, waiting, unsent, total: onYou.length + waiting.length + unsent.length };
}
