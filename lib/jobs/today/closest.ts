import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { roundLabel, roundsOf } from '@/lib/jobs/interview-groups';
import { DEBRIEF_NUDGE_WINDOW_DAYS, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { statusLabel } from '@/lib/jobs/status-label';
import type { TodayBoard } from './load';

/**
 * The applications closest to an offer, first on Today.
 *
 * Out of a few hundred applications, the handful at final round or in
 * process are where a job will come from, and they were in the middle of the
 * live list with one line each. This puts each of them on a card of its own
 * with what the next round needs: when it is, whether it has been prepared
 * for, what the earlier rounds covered, and whether the last one is still
 * owed a debrief.
 *
 * Everything here is read off the interviews already stored for the
 * application: its rounds (interview_groups), the prep you typed and the note
 * Dash wrote (`prep_notes`, `prep_note`), and what was written after each
 * round (`notes`, `questions_asked`, the round's own `notes`). A cancelled
 * interview is left out of all of it.
 *
 * closestToOffer is pure; loadClosestInterviews, at the bottom, reads the rows.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stages counted as close to an offer, in the order they are shown. */
export const CLOSEST_STATUSES: readonly ApplicationStatus[] = ['final_round', 'in_process'];

/** One interview on one of those applications, as the page reads it. */
export interface ClosestInterview {
  id: string;
  applicationId: string;
  scheduledAt: string | null;
  timeKnown: boolean;
  status: string | null;
  groupId: string | null;
  prepNotes: string | null;
  /** Dash's note. Only its presence is read. */
  hasPrepNote: boolean;
  notes: string | null;
  questionsAsked: readonly string[] | null;
  group: { id: string; label: string | null; roundNumber: number | null; notes: string | null } | null;
}

export interface ClosestRound {
  /** The round's id, or its one interview's when it stands alone (as debrief.ts keys it). */
  key: string;
  /** The interview a link lands on: the round's first. */
  leadId: string;
  /** "2 · Technical", "Round 3", or null when the round has neither. */
  label: string | null;
  scheduledAt: string;
  timeKnown: boolean;
}

export interface ClosestApplication {
  applicationId: string;
  roleId: string;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  stage: string;
  /** The next round still ahead, or null when none is booked. */
  next: (ClosestRound & { prepped: boolean }) | null;
  /**
   * When no round is booked, the latest round that was prepared for, so the
   * prep you already have is one press away. Null otherwise.
   */
  earlierPrep: ClosestRound | null;
  /** What the rounds already over left on record. */
  earlier: {
    rounds: number;
    /** Rounds with anything written after them. */
    written: number;
    /** Every question recorded as asked, oldest round first. */
    questions: number;
    firstQuestion: string | null;
  };
  /** Rounds over with nothing written about them. */
  debriefs: ClosestRound[];
}

/** When a round is over: its last conversation's hour, or the end of its day. */
function endOf(interview: { scheduledAt: string; timeKnown: boolean }): number {
  return new Date(interview.scheduledAt).getTime() + (interview.timeKnown ? 0 : DAY_MS);
}

function isPrepped(interview: ClosestInterview): boolean {
  return Boolean(interview.prepNotes?.trim()) || interview.hasPrepNote;
}

function questionsOf(interview: ClosestInterview): string[] {
  return (interview.questionsAsked ?? []).map((q) => q.trim()).filter(Boolean);
}

type Dated = ClosestInterview & { scheduledAt: string };

export function closestToOffer(
  pipeline: readonly PipelineRow[],
  interviews: readonly ClosestInterview[],
  now: Date,
): ClosestApplication[] {
  const nowMs = now.getTime();
  const debriefWindowStart = nowMs - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS;

  const byApplication = new Map<string, Dated[]>();
  for (const interview of interviews) {
    if (interview.status === 'cancelled' || !interview.scheduledAt) continue;
    if (!Number.isFinite(new Date(interview.scheduledAt).getTime())) continue;
    const list = byApplication.get(interview.applicationId) ?? [];
    list.push(interview as Dated);
    byApplication.set(interview.applicationId, list);
  }

  const result: ClosestApplication[] = [];
  for (const row of pipeline) {
    if (!CLOSEST_STATUSES.includes(row.status)) continue;

    const sorted = [...(byApplication.get(row.applicationId) ?? [])].sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    );
    const groups = new Map<string, NonNullable<ClosestInterview['group']>>();
    for (const interview of sorted) if (interview.group) groups.set(interview.group.id, interview.group);
    const rounds = roundsOf(
      sorted,
      [...groups.values()].map((group) => ({
        id: group.id,
        label: group.label,
        roundNumber: group.roundNumber,
        notes: group.notes ?? '',
      })),
    ).map(({ group, interviews: members, lead }) => ({
      round: {
        key: group?.id ?? lead.id,
        leadId: lead.id,
        label: roundLabel(group),
        scheduledAt: lead.scheduledAt,
        timeKnown: lead.timeKnown,
      } satisfies ClosestRound,
      members,
      endsAt: endOf(members[members.length - 1]),
      written:
        Boolean(group?.notes.trim()) ||
        members.some((member) => Boolean(member.notes?.trim()) || questionsOf(member).length > 0),
    }));

    // A round is ahead until it is over, so one under way this afternoon is
    // still the next round rather than an earlier one.
    const ahead = rounds.filter((round) => round.endsAt >= nowMs);
    const over = rounds.filter((round) => round.endsAt < nowMs);
    const next = ahead[0] ?? null;

    const lastPrepped = [...over].reverse().find((round) => round.members.some(isPrepped));
    const questions = over.flatMap((round) => round.members.flatMap(questionsOf));

    // The latest round over always asks while nothing is written about it:
    // on an application this close, last week's final is still worth writing
    // up. Older ones ask only inside This week's window, which is the rule
    // the nudge there follows, so a round never asks in one place and not the
    // other.
    const debriefs = over
      .filter(
        (round, index) =>
          !round.written && (index === over.length - 1 || round.endsAt >= debriefWindowStart),
      )
      .map((round) => round.round)
      .reverse();

    result.push({
      applicationId: row.applicationId,
      roleId: row.roleId,
      companyName: row.companyName,
      roleTitle: row.roleTitle,
      status: row.status,
      stage: statusLabel(row.status),
      next: next
        ? { ...next.round, prepped: next.members.some(isPrepped) }
        : null,
      earlierPrep: next || !lastPrepped ? null : lastPrepped.round,
      earlier: {
        rounds: over.length,
        written: over.filter((round) => round.written).length,
        questions: questions.length,
        firstQuestion: questions[0] ?? null,
      },
      debriefs,
    });
  }

  // Final round first, then the soonest next round, then the ones with none
  // booked, each group keeping the pipeline's own order.
  const rank = (app: ClosestApplication) => CLOSEST_STATUSES.indexOf(app.status);
  const nextAt = (app: ClosestApplication) =>
    app.next ? new Date(app.next.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
  return result
    .map((app, index) => ({ app, index }))
    .sort((a, b) => rank(a.app) - rank(b.app) || nextAt(a.app) - nextAt(b.app) || a.index - b.index)
    .map((entry) => entry.app);
}

/**
 * The board with the debriefs the section above it already asks for taken
 * out, so the same round is not nudged twice on one page.
 */
export function withoutClosestDebriefs(
  board: TodayBoard,
  closest: readonly ClosestApplication[],
): TodayBoard {
  const asked = new Set(closest.flatMap((app) => app.debriefs.map((round) => round.key)));
  if (asked.size === 0) return board;
  const debriefs = board.debriefs.filter((round) => !asked.has(round.key));
  return {
    ...board,
    debriefs,
    clear:
      board.interviews.length === 0 &&
      board.reminders.length === 0 &&
      board.waiting.length === 0 &&
      debriefs.length === 0,
  };
}

/**
 * Every interview on the given applications, in the shape closestToOffer
 * reads. One query for all of them; an error reads as none, since the
 * section is drawn from the pipeline either way and only loses its detail.
 */
export async function loadClosestInterviews(
  supabase: AppSupabaseClient,
  userId: string,
  applicationIds: readonly string[],
): Promise<ClosestInterview[]> {
  if (applicationIds.length === 0) return [];
  const { data } = await supabase
    .from('interviews')
    .select(
      'id, application_id, scheduled_at, time_known, status, group_id, prep_notes, prep_note, notes, questions_asked, interview_groups ( id, label, round_number, notes )',
    )
    .eq('user_id', userId)
    .in('application_id', [...applicationIds]);

  type Raw = {
    id: string;
    application_id: string;
    scheduled_at: string | null;
    time_known: boolean | null;
    status: string | null;
    group_id: string | null;
    prep_notes: string | null;
    prep_note: unknown;
    notes: string | null;
    questions_asked: string[] | null;
    interview_groups: {
      id: string;
      label: string | null;
      round_number: number | null;
      notes: string | null;
    } | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    applicationId: row.application_id,
    scheduledAt: row.scheduled_at,
    timeKnown: row.time_known !== false,
    status: row.status,
    groupId: row.group_id,
    prepNotes: row.prep_notes,
    hasPrepNote: row.prep_note != null,
    notes: row.notes,
    questionsAsked: row.questions_asked,
    group: row.interview_groups
      ? {
          id: row.interview_groups.id,
          label: row.interview_groups.label,
          roundNumber: row.interview_groups.round_number,
          notes: row.interview_groups.notes,
        }
      : null,
  }));
}
