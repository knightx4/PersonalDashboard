import type { Move } from '@/lib/core/move';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { applicationMove, lastTurnEvent } from '@/lib/jobs/move';
import type { ApplicationEventKind, ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The move of every application that has been sent and is still open, for
 * Todo's two lists (plan #1475): the ones on you go on the agenda, and the
 * ones waiting go in Waiting under the company.
 *
 * A lead or a draft is left out. Its move is on you, but it is a role you are
 * still deciding about, and the pipeline is where that is worked; putting
 * every lead on the agenda would bury the replies that need an answer.
 */

/** Sent and not closed: the statuses whose move can change hands. */
export const SENT_OPEN_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
];

export interface ApplicationMoveRow {
  applicationId: string;
  roleId: string;
  roleTitle: string;
  companyName: string;
  status: ApplicationStatus;
  move: Move;
  /** Why it is in that state, in the pipeline's own terms. */
  why: string;
  /** The last event that counts, which says what the move on you is. */
  lastEvent: ApplicationEventKind | null;
  /**
   * When the move last changed hands: the newest event that counts, else when
   * it was sent, else when the row was written.
   */
  since: string;
}

export interface ApplicationMoveInput {
  id: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  createdAt: string;
  roleId: string;
  roleTitle: string;
  companyName: string;
}

export interface ApplicationEventInput {
  applicationId: string;
  kind: string;
  occurredAt: string;
}

/** Pure: each application's move, from the rows and their events. */
export function applicationMoves(
  applications: readonly ApplicationMoveInput[],
  events: readonly ApplicationEventInput[],
): ApplicationMoveRow[] {
  const newestFirst = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const byApplication = new Map<string, ApplicationEventInput[]>();
  for (const event of newestFirst) {
    const list = byApplication.get(event.applicationId);
    if (list) list.push(event);
    else byApplication.set(event.applicationId, [event]);
  }

  const rows: ApplicationMoveRow[] = [];
  for (const application of applications) {
    const own = byApplication.get(application.id) ?? [];
    const lastEvent = lastTurnEvent(own.map((event) => event.kind));
    const result = applicationMove({
      status: application.status,
      lastEvent,
      companyName: application.companyName,
    });
    if (!result) continue;

    const turn = lastEvent ? own.find((event) => event.kind === lastEvent) : undefined;
    rows.push({
      applicationId: application.id,
      roleId: application.roleId,
      roleTitle: application.roleTitle,
      companyName: application.companyName,
      status: application.status,
      move: result.move,
      why: result.title,
      lastEvent,
      since: turn?.occurredAt ?? application.submittedAt ?? application.createdAt,
    });
  }
  return rows;
}

type RawRow = {
  id: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  created_at: string;
  roles: { id: string; title: string; companies: { name: string } | { name: string }[] } | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Read the sent, open applications and their events, and work out each move. */
export async function loadApplicationMoves(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<ApplicationMoveRow[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, status, submitted_at, created_at, roles!inner ( id, title, companies!inner ( name ) )')
    .eq('user_id', userId)
    .in('status', SENT_OPEN_STATUSES as ApplicationStatus[])
    .limit(500);
  if (error) throw new Error(error.message);

  const applications: ApplicationMoveInput[] = ((data ?? []) as unknown as RawRow[]).map((row) => {
    const role = one(row.roles);
    return {
      id: row.id,
      status: row.status,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      roleId: role?.id ?? '',
      roleTitle: role?.title ?? '',
      companyName: one(role?.companies)?.name ?? '',
    };
  });
  if (applications.length === 0) return [];

  const { data: events, error: eventsError } = await supabase
    .from('application_events')
    .select('application_id, kind, occurred_at')
    .eq('user_id', userId)
    .in(
      'application_id',
      applications.map((application) => application.id),
    );
  if (eventsError) throw new Error(eventsError.message);

  return applicationMoves(
    applications,
    (events ?? []).map((event) => ({
      applicationId: event.application_id as string,
      kind: event.kind as string,
      occurredAt: event.occurred_at as string,
    })),
  );
}
