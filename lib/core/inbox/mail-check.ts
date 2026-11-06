import type { ModuleId } from '@/lib/modules';

/**
 * Checking for new mail now, from the account menu (plans #3019, #3019.1).
 *
 * The rules the menu and its route share, with no database in them, so a test
 * can read them. The route that starts a check and reads its state is
 * app/api/inbox/check; the section that draws it is
 * components/shell/mail-check.tsx.
 *
 * The menu has a button per connected mailbox, and Check all. A sync already
 * runs one mailbox at a time and serves every workspace: one pass over the
 * mailbox offers each message to every workspace's linker
 * (inngest/core/inbox-sync.ts; startIncrementalSync takes the mailbox). So a
 * mailbox's button starts the pass the daily job runs, for that mailbox
 * alone, and Check all starts it for each. Narrowing a pass to one workspace
 * would move the mailbox's history cursor past mail the others never saw,
 * which is why the menu has no workspace buttons.
 */

/** What one linker made of a job's messages, added up over its batches. */
export type LinkedCount = { claimed: number; linked: number; failed: number; errors: number };

/** `core.sync_jobs.linked`: per linker domain. */
export type LinkedCounts = Record<string, LinkedCount>;

/** The shape fanOut returns per linker, restated here so this file stays client-safe. */
type FanOutEntry = { claimed: number; linked: number; failed: number } | { error: string };

/**
 * A workspace that reads mail, and the linkers that read it for it. The menu
 * uses these to say what a mailbox's check found for each workspace.
 *
 * Plain data with no functions in it, so the gallery (a server page) can hand
 * it to the menu, which is a client component.
 */
export type MailWorkspace = {
  id: ModuleId;
  label: string;
  domains: readonly string[];
};

/**
 * Every workspace with a linker in the sync, in the order results name them.
 *
 * News is not here: newsletters reach it by Mailgun forwarding them as they
 * arrive (app/api/news/inbound), so there is nothing in Gmail for it to check.
 * The mailroom linker is core's own sorting and belongs to no workspace.
 */
export const MAIL_WORKSPACES: readonly MailWorkspace[] = [
  { id: 'jobs', label: 'Jobs', domains: ['jobs'] },
  { id: 'shopping', label: 'Shopping', domains: ['commerce'] },
  { id: 'finances', label: 'Finances', domains: ['recurring'] },
  { id: 'todo', label: 'Todo', domains: ['appointments', 'replies'] },
];

/** The mail workspaces this account has switched on, in the menu's order. */
export function mailWorkspacesFor(enabled: readonly ModuleId[]): MailWorkspace[] {
  return MAIL_WORKSPACES.filter((w) => enabled.includes(w.id));
}

/** How long after a mailbox's check starts the next check of it may start. */
export const CHECK_COOLDOWN_MS = 60_000;

/** A queued or running job older than this is taken as dead (startIncrementalSync's rule). */
export const RUNNING_STALE_MS = 15 * 60_000;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Read `core.sync_jobs.linked` as stored, tolerating anything else in it. */
export function readLinked(value: unknown): LinkedCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: LinkedCounts = {};
  for (const [domain, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    out[domain] = {
      claimed: count(r.claimed),
      linked: count(r.linked),
      failed: count(r.failed),
      errors: count(r.errors),
    };
  }
  return out;
}

/** Add one batch's fan-out to what the job already holds. */
export function addFanOut(prev: unknown, batch: Record<string, FanOutEntry> | undefined): LinkedCounts {
  const out = readLinked(prev);
  for (const [domain, entry] of Object.entries(batch ?? {})) {
    const was = out[domain] ?? { claimed: 0, linked: 0, failed: 0, errors: 0 };
    out[domain] =
      'error' in entry
        ? { ...was, errors: was.errors + 1 }
        : {
            claimed: was.claimed + count(entry.claimed),
            linked: was.linked + count(entry.linked),
            failed: was.failed + count(entry.failed),
            errors: was.errors,
          };
  }
  return out;
}

/** One workspace's share of a check. */
export function workspaceCount(workspace: MailWorkspace, linked: LinkedCounts): LinkedCount {
  const total = { claimed: 0, linked: 0, failed: 0, errors: 0 };
  for (const domain of workspace.domains) {
    const c = linked[domain];
    if (!c) continue;
    total.claimed += c.claimed;
    total.linked += c.linked;
    total.failed += c.failed;
    total.errors += c.errors;
  }
  return total;
}

/**
 * The longest line under a mailbox that fits the menu's narrowest width (18rem
 * less its padding) in small text, in characters. Past it the breakdown is
 * left off, so the line never ends in a cut workspace name.
 */
export const MAILBOX_LINE_FITS = 46;

/**
 * The line under a mailbox: when it was checked, then what the check found,
 * with the per-workspace breakdown only when the whole line fits.
 */
export function mailboxLine(when: string, workspaces: readonly MailWorkspace[], linked: LinkedCounts | null): string {
  if (!linked) return when;
  const [head, breakdown] = mailboxResult(workspaces, linked).split(' · ');
  const short = `${when} · ${head}`;
  if (!breakdown) return short;
  const full = `${short} · ${breakdown}`;
  return full.length <= MAILBOX_LINE_FITS ? full : short;
}

/**
 * What a mailbox's check found: "3 new · 2 in Jobs, 1 in Shopping", or "Nothing
 * new". The breakdown names each switched-on workspace that took mail, in the
 * menu's order.
 */
export function mailboxResult(workspaces: readonly MailWorkspace[], linked: LinkedCounts): string {
  let claimed = 0;
  let failed = 0;
  let errors = 0;
  const parts: string[] = [];
  for (const workspace of workspaces) {
    const c = workspaceCount(workspace, linked);
    claimed += c.claimed;
    failed += c.failed;
    errors += c.errors;
    if (c.claimed > 0) parts.push(`${c.claimed} in ${workspace.label}`);
  }
  if (claimed === 0 && failed === 0) return errors > 0 ? 'Could not finish sorting the mail' : 'Nothing new';
  const head = [claimed > 0 ? `${claimed} new` : null, failed > 0 ? `${failed} could not be read` : null]
    .filter(Boolean)
    .join(', ');
  return parts.length > 0 ? `${head} · ${parts.join(', ')}` : head;
}

/** When the next check may start, or null when it may start now. */
export function nextCheckAt(lastStartedAt: string | null, now: number): string | null {
  if (!lastStartedAt) return null;
  const next = new Date(lastStartedAt).getTime() + CHECK_COOLDOWN_MS;
  return Number.isFinite(next) && next > now ? new Date(next).toISOString() : null;
}

/**
 * What went wrong with a mailbox, said for the person. The line sits under
 * the mailbox's address, so it does not repeat it.
 */
export type MailProblem = { kind: 'reconnect' | 'quota' | 'failed' | 'importing'; message: string };

const RECONNECT: MailProblem = { kind: 'reconnect', message: 'Gmail stopped letting the app read this mailbox.' };

/**
 * A sync job's stored error in plain words.
 *
 * The stored text is whatever Gmail or the token refresh threw. The two the
 * person can act on are a token Google no longer honours, which takes a
 * reconnect, and Gmail's rate limit, which takes waiting.
 */
export function plainProblem(raw: string): MailProblem {
  const text = raw.toLowerCase();
  if (/invalid_grant|unauthori[sz]ed|401|token (has been )?(expired|revoked)|reconnect|consent/.test(text)) {
    return RECONNECT;
  }
  if (/quota|rate ?limit|429|too many requests|user-rate/.test(text)) {
    return { kind: 'quota', message: 'Gmail is limiting how fast it answers. Try again in a few minutes.' };
  }
  return { kind: 'failed', message: `The last check stopped part way: ${raw.slice(0, 140)}` };
}

/** One connected mailbox, as its row in the menu draws it. */
export type MailboxCheck = {
  id: string;
  email: string;
  /** Active and past its first import, so a check can run at all. */
  checkable: boolean;
  /** A check of this mailbox, pressed or scheduled, is under way. */
  running: boolean;
  /** The last time this mailbox finished a sync, scheduled or pressed. */
  lastCheckedAt: string | null;
  /** When this mailbox may be checked again, or null when it may now. */
  nextAllowedAt: string | null;
  /** What its latest finished check found. Null before any recorded result. */
  linked: LinkedCounts | null;
  problem: MailProblem | null;
};

/** What the menu needs to draw the section. */
export type MailCheckStatus = {
  /** Every connected mailbox, whatever its state. None draws the Connect Gmail link. */
  mailboxes: MailboxCheck[];
  /** Any mailbox is being checked. */
  running: boolean;
};

/** A sync job as the route reads it. */
export type CheckJob = {
  email_account_id: string;
  status: string;
  error: string | null;
  linked: unknown;
  started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CheckAccount = {
  id: string;
  email_address: string;
  status: string;
  last_synced_at: string | null;
  backfill_completed_at: string | null;
};

/** A mailbox a press would start a check of now. */
export function canStart(mailbox: MailboxCheck): boolean {
  return mailbox.checkable && !mailbox.running && !mailbox.nextAllowedAt;
}

function mailboxCheck(account: CheckAccount, job: CheckJob | undefined, now: number): MailboxCheck {
  const base: MailboxCheck = {
    id: account.id,
    email: account.email_address,
    checkable: false,
    running: false,
    lastCheckedAt: account.last_synced_at,
    nextAllowedAt: null,
    linked: null,
    problem: null,
  };
  if (account.status === 'needs_reauth') return { ...base, problem: RECONNECT };
  if (account.status !== 'active') {
    return { ...base, problem: { kind: 'reconnect', message: 'This mailbox stopped syncing.' } };
  }
  if (!account.backfill_completed_at) {
    return {
      ...base,
      problem: { kind: 'importing', message: 'Still on its first import. Checking starts once that finishes.' },
    };
  }
  if (!job) return { ...base, checkable: true };

  const running =
    (job.status === 'queued' || job.status === 'running') &&
    now - new Date(job.updated_at).getTime() < RUNNING_STALE_MS;
  const finished = job.status === 'completed' || job.status === 'failed';
  return {
    ...base,
    checkable: true,
    running,
    nextAllowedAt: nextCheckAt(job.started_at ?? job.created_at, now),
    linked: finished ? readLinked(job.linked) : null,
    problem: job.status === 'failed' && job.error ? plainProblem(job.error) : null,
  };
}

/**
 * The section's state from the account's mailboxes and their recent jobs.
 *
 * `jobs` is newest first. For each mailbox the latest incremental job is its
 * latest check, scheduled or pressed; its counts make the result and its
 * error the problem.
 */
export function mailCheckStatus(
  accounts: readonly CheckAccount[],
  jobs: readonly CheckJob[],
  now: number,
): MailCheckStatus {
  const latest = new Map<string, CheckJob>();
  for (const job of jobs) if (!latest.has(job.email_account_id)) latest.set(job.email_account_id, job);
  const mailboxes = accounts.map((account) => mailboxCheck(account, latest.get(account.id), now));
  return { mailboxes, running: mailboxes.some((m) => m.running) };
}

/** What a press asks the route to do. */
export type CheckPlan =
  /** Start a check of these mailboxes; `joined` when others asked for are already under way. */
  | { kind: 'start'; ids: string[]; joined: boolean }
  /** Nothing to start: every mailbox asked for is already being checked. */
  | { kind: 'joined' }
  /** Nothing to start: checked under a minute ago. */
  | { kind: 'wait'; message: string }
  /** Nothing that can be checked: not connected, needing a reconnect, or importing. */
  | { kind: 'none'; message: string };

/**
 * Which mailboxes a press starts. A mailbox's button names it; Check all
 * names none and takes every mailbox that can start, joining those already
 * under way.
 */
export function planCheck(status: MailCheckStatus, mailboxId: string | null): CheckPlan {
  const asked = mailboxId ? status.mailboxes.filter((m) => m.id === mailboxId) : status.mailboxes;
  if (asked.length === 0) return { kind: 'none', message: 'That mailbox is not connected.' };
  const checkable = asked.filter((m) => m.checkable);
  if (checkable.length === 0) {
    return {
      kind: 'none',
      message: mailboxId ? (asked[0].problem?.message ?? 'This mailbox cannot be checked now.') : 'No mailbox can be checked now.',
    };
  }
  const ids = checkable.filter(canStart).map((m) => m.id);
  const joined = checkable.some((m) => m.running);
  if (ids.length > 0) return { kind: 'start', ids, joined };
  if (joined) return { kind: 'joined' };
  return {
    kind: 'wait',
    message: mailboxId
      ? `${asked[0].email} was checked under a minute ago.`
      : 'Every mailbox was checked under a minute ago.',
  };
}
