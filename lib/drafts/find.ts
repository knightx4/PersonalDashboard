import { addDays } from '@/lib/todo/tasks/model';

/**
 * Which messages are due to be written (plan #1129): a job application that
 * has gone quiet for longer than that company usually takes to reply, and an
 * order holding something marked to go back whose return window is about to
 * close.
 *
 * Pure. The rows come in already read (inngest/core/drafts.ts), and the
 * clock and the day come in as arguments, so every threshold here is tested
 * against rows written by hand.
 */

export type DraftKind = 'follow_up' | 'return_request';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a company usually takes when there is nothing to measure it by. */
export const DEFAULT_REPLY_DAYS = 14;

/**
 * The bounds on a measured reply time. One company that answered the same
 * afternoon should not have a follow-up drafted two days after applying, and
 * one that took two months should still get one before the application is
 * written off as ghosted at thirty days (lib/jobs/pipeline.ts).
 */
export const MIN_REPLY_DAYS = 5;
export const MAX_REPLY_DAYS = 28;

/**
 * How long past the usual reply time a follow-up is still worth drafting.
 * Past it the application has been quiet long enough that a nudge reads as
 * an afterthought, and the pipeline is about to call it ghosted anyway.
 */
export const FOLLOW_UP_WINDOW_DAYS = 14;

/** How close a return deadline has to be for the request to be written. */
export const RETURN_LEAD_DAYS = 3;

/** How long a draft waits on the agenda before it is withdrawn. */
export const DRAFT_LIFE_DAYS = 3;

/**
 * New drafts of one kind a person gets in a day. The first morning after
 * this shipped there were a dozen quiet applications; a dozen drafts at once
 * is the pile the three-day expiry exists to prevent.
 */
export const MAX_NEW_PER_DAY = 3;

/** Statuses where an application is still waiting on the company. */
export const OPEN_STATUSES = ['submitted', 'acknowledged', 'in_process', 'final_round'] as const;

/** Event kinds that are the person's own bookkeeping, not word from anyone. */
const NOT_WORD = new Set(['note', 'status_override']);

export function daysBetweenInstants(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * How many days this company usually takes to answer, from the gaps between
 * submitting and the first reply from a person on the person's own earlier
 * applications there. The median, so one very slow answer does not move it,
 * and DEFAULT_REPLY_DAYS when there is nothing to measure.
 */
export function usualReplyDays(gaps: readonly number[]): number {
  const usable = gaps.filter((gap) => Number.isFinite(gap) && gap >= 0).sort((a, b) => a - b);
  if (usable.length === 0) return DEFAULT_REPLY_DAYS;
  const middle = Math.floor(usable.length / 2);
  const median =
    usable.length % 2 === 1
      ? usable[middle]
      : Math.round((usable[middle - 1] + usable[middle]) / 2);
  return Math.min(MAX_REPLY_DAYS, Math.max(MIN_REPLY_DAYS, median));
}

export type ApplicationFacts = {
  id: string;
  status: string;
  companyId: string | null;
  companyName: string;
  roleTitle: string | null;
  submittedAt: string | null;
  firstHumanResponseAt: string | null;
};

export type EventFacts = { applicationId: string; kind: string; occurredAt: string };

export type FollowUpCandidate = {
  kind: 'follow_up';
  aboutId: string;
  /** The last word on the application, which a new reply moves. */
  basis: string;
  companyName: string;
  roleTitle: string | null;
  submittedAt: string | null;
  quietDays: number;
  usualDays: number;
  /** True when the usual time was measured rather than assumed. */
  measured: boolean;
};

/**
 * The applications quiet for at least the company's usual reply time and at
 * most FOLLOW_UP_WINDOW_DAYS beyond it, the most recently crossed first.
 *
 * Quiet is measured from the last event that was not the person's own note:
 * a confirmation, a reply, an invitation. An application with an interview
 * still to come is not quiet, whatever its mail says.
 */
export function quietApplications(input: {
  applications: readonly ApplicationFacts[];
  events: readonly EventFacts[];
  /** Applications with an interview from yesterday on. */
  upcomingInterviews: ReadonlySet<string>;
  now: Date;
}): FollowUpCandidate[] {
  const gapsByCompany = new Map<string, number[]>();
  for (const app of input.applications) {
    if (!app.companyId || !app.submittedAt || !app.firstHumanResponseAt) continue;
    const gap = daysBetweenInstants(new Date(app.submittedAt), new Date(app.firstHumanResponseAt));
    gapsByCompany.set(app.companyId, [...(gapsByCompany.get(app.companyId) ?? []), gap]);
  }

  const lastWord = new Map<string, string>();
  for (const event of input.events) {
    if (NOT_WORD.has(event.kind)) continue;
    const current = lastWord.get(event.applicationId);
    if (!current || Date.parse(event.occurredAt) > Date.parse(current)) {
      lastWord.set(event.applicationId, event.occurredAt);
    }
  }

  const open = new Set<string>(OPEN_STATUSES);
  const found: FollowUpCandidate[] = [];
  for (const app of input.applications) {
    if (!open.has(app.status)) continue;
    if (input.upcomingInterviews.has(app.id)) continue;
    const since = lastWord.get(app.id) ?? app.submittedAt;
    if (!since) continue;

    const gaps = app.companyId ? (gapsByCompany.get(app.companyId) ?? []) : [];
    const usualDays = usualReplyDays(gaps);
    const quietDays = daysBetweenInstants(new Date(since), input.now);
    if (quietDays < usualDays || quietDays > usualDays + FOLLOW_UP_WINDOW_DAYS) continue;

    found.push({
      kind: 'follow_up',
      aboutId: app.id,
      basis: new Date(since).toISOString(),
      companyName: app.companyName,
      roleTitle: app.roleTitle,
      submittedAt: app.submittedAt,
      quietDays,
      usualDays,
      measured: gaps.length > 0,
    });
  }

  return found.sort((a, b) => a.quietDays - a.usualDays - (b.quietDays - b.usualDays));
}

export type ReturnItemFacts = {
  orderId: string;
  orderStatus: string;
  deletedAt: string | null;
  returnDeadline: string | null;
  merchantName: string | null;
  externalOrderNumber: string | null;
  orderDate: string | null;
  itemName: string;
  variant: string | null;
  costCents: number | null;
};

export type ReturnCandidate = {
  kind: 'return_request';
  aboutId: string;
  /** The deadline: a window that is extended is a new one. */
  basis: string;
  merchantName: string;
  externalOrderNumber: string | null;
  orderDate: string | null;
  deadline: string;
  daysLeft: number;
  items: { name: string; variant: string | null; costCents: number | null }[];
};

/**
 * One request per order holding items marked to go back, when the order's
 * return window closes within RETURN_LEAD_DAYS of today (today included).
 * The soonest deadline first.
 *
 * "Marked to go back" is the Plan return switch on the item
 * (inventory_items.return_planned): it is the only record of an item the
 * person does not mean to keep, and drafting a return for every order with
 * an open window would ask them to send back things they are using.
 */
export function closingReturns(
  items: readonly ReturnItemFacts[],
  today: string,
): ReturnCandidate[] {
  const last = addDays(today, RETURN_LEAD_DAYS);
  const byOrder = new Map<string, ReturnCandidate>();

  for (const item of items) {
    const deadline = item.returnDeadline;
    if (!deadline || deadline < today || deadline > last) continue;
    if (item.deletedAt || item.orderStatus === 'returned' || item.orderStatus === 'cancelled')
      continue;

    const existing = byOrder.get(item.orderId);
    const entry = { name: item.itemName, variant: item.variant, costCents: item.costCents };
    if (existing) {
      existing.items.push(entry);
      continue;
    }
    byOrder.set(item.orderId, {
      kind: 'return_request',
      aboutId: item.orderId,
      basis: deadline,
      merchantName: item.merchantName?.trim() || 'the shop',
      externalOrderNumber: item.externalOrderNumber,
      orderDate: item.orderDate,
      deadline,
      daysLeft: Math.round(
        (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
      ),
      items: [entry],
    });
  }

  return [...byOrder.values()].sort((a, b) => a.deadline.localeCompare(b.deadline));
}

/** The line shown beside a draft on the agenda: why it is due now. */
export function draftReason(candidate: FollowUpCandidate | ReturnCandidate): string {
  if (candidate.kind === 'follow_up') {
    const role = candidate.roleTitle ? `${candidate.roleTitle}, ` : '';
    const usual = candidate.measured
      ? `they usually reply within ${candidate.usualDays} days`
      : `no reply after ${candidate.usualDays} days is the usual point to ask`;
    return `${role}quiet for ${candidate.quietDays} days; ${usual}`;
  }
  const number = candidate.externalOrderNumber ? `Order #${candidate.externalOrderNumber}, ` : '';
  const when =
    candidate.daysLeft === 0
      ? 'the return window closes today'
      : candidate.daysLeft === 1
        ? 'the return window closes tomorrow'
        : `the return window closes in ${candidate.daysLeft} days`;
  return `${number}${when}`;
}

/** What the agenda and the morning brief call a draft. */
export function draftTitle(kind: DraftKind, label: string): string {
  return kind === 'follow_up'
    ? `Send the follow-up to ${label}`
    : `Send the return request to ${label}`;
}

/** When a draft that appears at `from` stops showing if nobody acts on it. */
export function draftExpiry(from: Date): string {
  return new Date(from.getTime() + DRAFT_LIFE_DAYS * DAY_MS).toISOString();
}

/**
 * A reply address nobody reads. A draft is still written without a
 * recipient: an unaddressed draft is a smaller problem than none, and the
 * person can paste the address in.
 */
export function isNoReply(address: string | null | undefined): boolean {
  if (!address) return false;
  return /(^|[^a-z])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|notifications?)([^a-z]|$)/i.test(
    address.split('@')[0] ?? '',
  );
}

export const MAX_SUBJECT_CHARS = 200;
export const MAX_BODY_CHARS = 3000;

/**
 * A written message as it may be stored, or null when it is unusable: empty
 * or too long. Dashes used for rhythm become commas, as the writing guide
 * asks, and trailing space on each line goes.
 */
export function checkDraft(draft: {
  subject: string;
  body: string;
}): { subject: string; body: string } | null {
  const subject = draft.subject
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  const body = draft.body
    .replace(/\s*[—–]\s*/g, ', ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!subject || !body) return null;
  if (subject.length > MAX_SUBJECT_CHARS || body.length > MAX_BODY_CHARS) return null;
  return { subject, body };
}
