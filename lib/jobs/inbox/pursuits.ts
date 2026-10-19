import { isTerminal, type ApplicationStatus } from '@/lib/jobs/pipeline';

// Which pursuit, of the roles and applications a company already has, a new
// piece of evidence belongs to. Pure, and free of 'server-only', so the inbox
// (ingest-messages.ts, which re-exports these) and the LinkedIn import
// (lib/imports/linkedin/applications.ts) give the same answer.

/**
 * What a role is called when the mail did not say.
 *
 * Exported so the dedupe below can recognise its own placeholders: a row with
 * this title is "we know there is something here" rather than a distinct
 * pursuit, and treating it as distinct is what produced two rows for one
 * conversation.
 */
export const PLACEHOLDER_ROLE_TITLE = 'Role from email';

export type OpenPursuit = { roleId: string; roleTitle: string; applicationId: string };

export type PursuitChoice =
  | { kind: 'create' }
  | { kind: 'adopt'; applicationId: string }
  | { kind: 'rename'; applicationId: string; roleId: string };

/**
 * Which pursuit at this company an inferred message belongs to.
 *
 * A title match is the easy case and was the only case, which is how one
 * company ended up with "Finance Manager" and "Role from email" open beside
 * each other, both from the same conversation. A title the model could not
 * read is not evidence of a second pursuit -- it is the absence of evidence
 * either way.
 *
 * The two placeholder cases both insist on exactly one candidate. Where a
 * company has several things open, which one an untitled message belongs to is
 * a guess, and silently attaching mail to the wrong role is worse than a
 * duplicate row you can see and merge.
 */
export function choosePursuit(open: readonly OpenPursuit[], title: string): PursuitChoice {
  const wanted = title.toLowerCase();
  const isPlaceholder = (pursuit: OpenPursuit) =>
    pursuit.roleTitle.toLowerCase() === PLACEHOLDER_ROLE_TITLE.toLowerCase();

  const sameTitle = open.find((pursuit) => pursuit.roleTitle.toLowerCase() === wanted);
  if (sameTitle) return { kind: 'adopt', applicationId: sameTitle.applicationId };

  if (wanted === PLACEHOLDER_ROLE_TITLE.toLowerCase()) {
    return open.length === 1
      ? { kind: 'adopt', applicationId: open[0].applicationId }
      : { kind: 'create' };
  }

  const placeholders = open.filter(isPlaceholder);
  if (placeholders.length === 1) {
    return {
      kind: 'rename',
      applicationId: placeholders[0].applicationId,
      roleId: placeholders[0].roleId,
    };
  }

  return { kind: 'create' };
}

/** A pursuit at the company, open or closed, as the dedupe reads it. */
export type KnownPursuit = OpenPursuit & {
  atsJobId: string | null;
  closed: boolean;
  /** When a closed pursuit closed; null while it is open or where nobody recorded it. */
  closedAt: Date | null;
  createdAt: Date | null;
};

/** What the message says about the pursuit it belongs to. */
export type PursuitMessage = {
  title: string;
  atsJobId: string | null;
  receivedAt: Date | null;
  /**
   * Whether this kind of mail begins a pursuit: a confirmation that you
   * applied, or a recruiter's first approach. Anything else (a rejection, an
   * assessment, an offer) continues one that already exists.
   */
  startsPursuit: boolean;
};

function sameAtsJobId(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function latestPursuit(pursuits: readonly KnownPursuit[]): KnownPursuit {
  return [...pursuits].sort(
    (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
  )[0];
}

/**
 * Whether the message is a fresh attempt at a pursuit that has closed.
 *
 * Only mail that begins a pursuit, dated after the closed one closed, reads
 * that way. A confirmation dated before the rejection is the old attempt's own
 * confirmation arriving late, which is what a rescan of old mail produces for
 * every pursuit it touches, and it belongs on the closed row. A message with no
 * date cannot show it came later, so it is read as the old attempt's too.
 */
function reapplies(closed: KnownPursuit, message: PursuitMessage): boolean {
  return (
    message.startsPursuit &&
    message.receivedAt !== null &&
    closed.closedAt !== null &&
    message.receivedAt.getTime() > closed.closedAt.getTime()
  );
}

/**
 * Which pursuit at this company an inferred message belongs to, closed ones
 * included.
 *
 * choosePursuit only looks at open pursuits, so a confirmation for a role
 * already rejected or ghosted opened a second role and application beside the
 * first; a rescan of old mail did this for dozens of roles at once. In order:
 *
 *   1. The posting's ATS job id. An open pursuit with it is adopted; otherwise
 *      the latest closed one is, unless the message is a re-application.
 *   2. The open pursuits, by choosePursuit's rules, unchanged.
 *   3. A closed pursuit with exactly the same title, and no conflicting job
 *      id, on the same terms as step 1. A placeholder title never matches a
 *      closed pursuit: it says nothing about which role the mail is about.
 *
 * A re-application (see reapplies) still opens its own pursuit, as it always
 * has. Adopting a closed pursuit files the message's event on it; the
 * transition gate in writeEvent keeps that event from reopening it.
 */
export function choosePursuitFor(
  known: readonly KnownPursuit[],
  message: PursuitMessage,
): PursuitChoice {
  const atsJobId = message.atsJobId?.trim() || null;

  if (atsJobId) {
    const posting = known.filter((pursuit) => sameAtsJobId(pursuit.atsJobId, atsJobId));
    const open = posting.filter((pursuit) => !pursuit.closed);
    if (open.length > 0) return { kind: 'adopt', applicationId: latestPursuit(open).applicationId };
    if (posting.length > 0) {
      const last = latestPursuit(posting);
      if (!reapplies(last, message)) return { kind: 'adopt', applicationId: last.applicationId };
    }
  }

  const openChoice = choosePursuit(
    known.filter((pursuit) => !pursuit.closed),
    message.title,
  );
  if (openChoice.kind !== 'create') return openChoice;

  const wanted = message.title.trim().toLowerCase();
  if (wanted !== PLACEHOLDER_ROLE_TITLE.toLowerCase()) {
    const sameTitle = known.filter(
      (pursuit) =>
        pursuit.closed &&
        pursuit.roleTitle.trim().toLowerCase() === wanted &&
        !(pursuit.atsJobId && atsJobId && !sameAtsJobId(pursuit.atsJobId, atsJobId)),
    );
    if (sameTitle.length > 0) {
      const last = latestPursuit(sameTitle);
      if (!reapplies(last, message)) return { kind: 'adopt', applicationId: last.applicationId };
    }
  }

  return { kind: 'create' };
}

type RoleWithApplications = {
  id: unknown;
  title: unknown;
  ats_job_id?: unknown;
  created_at?: unknown;
  applications?: unknown;
};

type ApplicationAttempt = {
  id: string;
  status: string;
  attempt?: number | null;
  closed_at?: string | null;
  created_at?: string | null;
};

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The company's roles as pursuits: each role's live application, or its
 * latest attempt when every attempt has closed. A role with no application is
 * left out, as it always was.
 */
export function pursuitsFromRoles(roles: readonly RoleWithApplications[]): KnownPursuit[] {
  const pursuits: KnownPursuit[] = [];
  for (const role of roles) {
    const applications = (role.applications ?? []) as ApplicationAttempt[];
    if (applications.length === 0) continue;
    const live = applications.find((a) => !isTerminal(a.status as ApplicationStatus));
    const chosen =
      live ??
      [...applications].sort(
        (a, b) =>
          (b.attempt ?? 0) - (a.attempt ?? 0) ||
          (dateOrNull(b.created_at)?.getTime() ?? 0) - (dateOrNull(a.created_at)?.getTime() ?? 0),
      )[0];
    pursuits.push({
      roleId: role.id as string,
      roleTitle: (role.title as string | null) ?? '',
      applicationId: chosen.id,
      atsJobId: (role.ats_job_id as string | null | undefined) ?? null,
      closed: !live,
      closedAt: live ? null : dateOrNull(chosen.closed_at),
      createdAt: dateOrNull(chosen.created_at) ?? dateOrNull(role.created_at),
    });
  }
  return pursuits;
}
