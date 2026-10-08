import { DEBRIEF_NUDGE_WINDOW_DAYS } from '@/lib/jobs/pipeline';
import { roundsOf } from '@/lib/jobs/interview-groups';

/**
 * The rounds still owing a debrief, for This week on Today (plan #1591).
 *
 * This was the Interviews tab's "Write these up tonight" banner, with the
 * tab's own rule: a round is over once its last conversation is (a day-only
 * one once its day is), and it owes a debrief while nothing is written
 * anywhere in it, the round's own note or any of its conversations'. Only
 * the last DEBRIEF_NUDGE_WINDOW_DAYS count: a round from months ago with no
 * notes is stale rather than something to write up tonight.
 *
 * Pure.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DebriefInterview {
  id: string;
  scheduledAt: string;
  timeKnown: boolean;
  groupId: string | null;
  notes: string | null;
  roleId: string;
  companyName: string;
  roleTitle: string;
}

export interface DebriefGroup {
  id: string;
  label: string | null;
  notes: string;
}

export interface DebriefDue {
  /** The round's id, or its one interview's when it stands alone. */
  key: string;
  /** The interview a link lands on: the round's first. */
  leadId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  /** When the round started, as the line shows it. */
  scheduledAt: string;
  timeKnown: boolean;
}

export function debriefsDue(
  interviews: readonly DebriefInterview[],
  groups: readonly DebriefGroup[],
  now: Date,
): DebriefDue[] {
  const nowMs = now.getTime();
  const windowStart = nowMs - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;
  const sorted = [...interviews].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const due: DebriefDue[] = [];
  for (const { group, interviews: members, lead } of roundsOf(sorted, groups)) {
    const last = members[members.length - 1];
    const endsAt = new Date(last.scheduledAt).getTime() + (last.timeKnown ? 0 : DAY_MS);
    if (!Number.isFinite(endsAt) || endsAt >= nowMs || endsAt < windowStart) continue;
    const written =
      Boolean(group?.notes.trim()) || members.some((member) => Boolean(member.notes?.trim()));
    if (written) continue;
    due.push({
      key: group?.id ?? lead.id,
      leadId: lead.id,
      roleId: lead.roleId,
      companyName: lead.companyName,
      roleTitle: lead.roleTitle,
      scheduledAt: lead.scheduledAt,
      timeKnown: lead.timeKnown,
    });
  }
  // The most recent first: tonight's is the one still fresh enough to write.
  return due.reverse();
}
