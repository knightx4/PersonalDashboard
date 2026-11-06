import type { ModuleId } from '@/lib/modules';

/**
 * Checking for new mail now, from the account menu (plan #3019).
 *
 * The rules the menu and its route share, with no database in them, so a test
 * can read them. The route that starts a check and reads its state is
 * app/api/inbox/check; the section that draws it is
 * components/shell/mail-check.tsx.
 *
 * There is one sync, and it serves every workspace: one pass over each
 * connected mailbox offers every message to each workspace's linker
 * (inngest/core/inbox-sync.ts). So a workspace's button and Check all start
 * the same pass, the one the daily job runs, and differ in which result the
 * menu puts first. Narrowing the pass to one workspace would move the
 * mailbox's history cursor past mail the others never saw.
 */

/** What one linker made of a job's messages, added up over its batches. */
export type LinkedCount = { claimed: number; linked: number; failed: number; errors: number };

/** `core.sync_jobs.linked`: per linker domain. */
export type LinkedCounts = Record<string, LinkedCount>;

/** The shape fanOut returns per linker, restated here so this file stays client-safe. */
type FanOutEntry = { claimed: number; linked: number; failed: number } | { error: string };

/**
 * A workspace that reads mail, and the linkers that read it for it.
 *
 * Plain data with no functions in it, so the gallery (a server page) can hand
 * it to the menu, which is a client component.
 */
export type MailWorkspace = {
  id: ModuleId;
  label: string;
  domains: readonly string[];
  /** What its linked records are, for one and for many: "1 order updated", "2 orders updated". */
  linkedAs: readonly [one: string, many: string];
};

/**
 * Every workspace with a linker in the sync, in the order the menu lists them.
 *
 * News is not here: newsletters reach it by Mailgun forwarding them as they
 * arrive (app/api/news/inbound), so there is nothing in Gmail for it to check.
 * The mailroom linker is core's own sorting and belongs to no workspace.
 */
export const MAIL_WORKSPACES: readonly MailWorkspace[] = [
  { id: 'jobs', label: 'Jobs', domains: ['jobs'], linkedAs: ['linked to a role', 'linked to a role'] },
  { id: 'shopping', label: 'Shopping', domains: ['commerce'], linkedAs: ['order updated', 'orders updated'] },
  { id: 'finances', label: 'Finances', domains: ['recurring'], linkedAs: ['bill filed', 'bills filed'] },
  { id: 'todo', label: 'Todo', domains: ['appointments', 'replies'], linkedAs: ['added to Todo', 'added to Todo'] },
];

/** The mail workspaces this account has switched on, in the menu's order. */
export function mailWorkspacesFor(enabled: readonly ModuleId[]): MailWorkspace[] {
  return MAIL_WORKSPACES.filter((w) => enabled.includes(w.id));
}

/** How long after a check starts the next may start. */
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

/** Add several jobs' counts together: one check runs a job per mailbox. */
export function sumLinked(all: readonly unknown[]): LinkedCounts {
  const out: LinkedCounts = {};
  for (const one of all) {
    for (const [domain, c] of Object.entries(readLinked(one))) {
      const was = out[domain] ?? { claimed: 0, linked: 0, failed: 0, errors: 0 };
      out[domain] = {
        claimed: was.claimed + c.claimed,
        linked: was.linked + c.linked,
        failed: was.failed + c.failed,
        errors: was.errors + c.errors,
      };
    }
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

/** The result line beside a workspace: "2 new, 1 linked to a role", or "Nothing new". */
export function resultLine(workspace: MailWorkspace, c: LinkedCount): string {
  const parts: string[] = [];
  if (c.claimed > 0) parts.push(`${c.claimed} new`);
  if (c.linked > 0) parts.push(`${c.linked} ${workspace.linkedAs[c.linked === 1 ? 0 : 1]}`);
  if (c.failed > 0) parts.push(`${c.failed} could not be read`);
  if (c.errors > 0 && parts.length === 0) return 'Could not finish sorting the mail';
  return parts.length === 0 ? 'Nothing new' : parts.join(', ');
}

/** When the next check may start, or null when it may start now. */
export function nextCheckAt(lastStartedAt: string | null, now: number): string | null {
  if (!lastStartedAt) return null;
  const next = new Date(lastStartedAt).getTime() + CHECK_COOLDOWN_MS;
  return Number.isFinite(next) && next > now ? new Date(next).toISOString() : null;
}

/** What went wrong with a check, said for the person. */
export type MailProblem = { kind: 'reconnect' | 'quota' | 'failed' | 'importing'; message: string; email?: string };

/**
 * A sync job's stored error in plain words.
 *
 * The stored text is whatever Gmail or the token refresh threw. The two the
 * person can act on are a token Google no longer honours, which takes a
 * reconnect, and Gmail's rate limit, which takes waiting.
 */
export function plainProblem(raw: string, email?: string): MailProblem {
  const text = raw.toLowerCase();
  if (/invalid_grant|unauthori[sz]ed|401|token (has been )?(expired|revoked)|reconnect|consent/.test(text)) {
    return {
      kind: 'reconnect',
      email,
      message: `Gmail stopped letting the app read ${email ?? 'this mailbox'}. Reconnect it to check again.`,
    };
  }
  if (/quota|rate ?limit|429|too many requests|user-rate/.test(text)) {
    return { kind: 'quota', email, message: 'Gmail is limiting how fast it answers. Try again in a few minutes.' };
  }
  return {
    kind: 'failed',
    email,
    message: `The last check of ${email ?? 'your mail'} stopped part way: ${raw.slice(0, 140)}`,
  };
}

/** What the menu needs to draw the section. */
export type MailCheckStatus = {
  /** Mailboxes connected, whatever their state. None draws the Connect Gmail link. */
  mailboxes: number;
  running: boolean;
  /** The last time any mailbox finished a sync, scheduled or pressed. */
  lastCheckedAt: string | null;
  nextAllowedAt: string | null;
  /** What the latest check of each mailbox found, added up. Null before any recorded result. */
  linked: LinkedCounts | null;
  problems: MailProblem[];
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

/**
 * The section's state from the account's mailboxes and their recent jobs.
 *
 * `jobs` is newest first. For each mailbox the latest incremental job is the
 * latest check; its counts make the results and its error the problem.
 */
export function mailCheckStatus(
  accounts: readonly CheckAccount[],
  jobs: readonly CheckJob[],
  now: number,
): MailCheckStatus {
  const latest = new Map<string, CheckJob>();
  for (const job of jobs) if (!latest.has(job.email_account_id)) latest.set(job.email_account_id, job);

  const problems: MailProblem[] = [];
  let running = false;
  let lastCheckedAt: string | null = null;
  let lastStartedAt: string | null = null;
  const finished: unknown[] = [];

  for (const account of accounts) {
    if (account.last_synced_at && (!lastCheckedAt || account.last_synced_at > lastCheckedAt)) {
      lastCheckedAt = account.last_synced_at;
    }
    if (account.status === 'needs_reauth') {
      problems.push({
        kind: 'reconnect',
        email: account.email_address,
        message: `Gmail stopped letting the app read ${account.email_address}. Reconnect it to check again.`,
      });
      continue;
    }
    if (account.status !== 'active') continue;
    if (!account.backfill_completed_at) {
      problems.push({
        kind: 'importing',
        email: account.email_address,
        message: `${account.email_address} is still on its first import. Checking starts once that finishes.`,
      });
      continue;
    }
    const job = latest.get(account.id);
    if (!job) continue;
    const started = job.started_at ?? job.created_at;
    if (!lastStartedAt || started > lastStartedAt) lastStartedAt = started;
    const live =
      (job.status === 'queued' || job.status === 'running') &&
      now - new Date(job.updated_at).getTime() < RUNNING_STALE_MS;
    if (live) running = true;
    else if (job.status === 'completed') finished.push(job.linked);
    else if (job.status === 'failed' && job.error) {
      finished.push(job.linked);
      problems.push(plainProblem(job.error, account.email_address));
    }
  }

  const linked = finished.length > 0 ? sumLinked(finished) : null;
  return {
    mailboxes: accounts.length,
    running,
    lastCheckedAt,
    nextAllowedAt: nextCheckAt(lastStartedAt, now),
    linked,
    problems,
  };
}
