import { describe, expect, it } from 'vitest';
import {
  MAIL_WORKSPACES,
  addFanOut,
  mailCheckStatus,
  mailWorkspacesFor,
  nextCheckAt,
  plainProblem,
  resultLine,
  sumLinked,
  workspaceCount,
  type CheckAccount,
  type CheckJob,
} from './mail-check';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const jobs = MAIL_WORKSPACES.find((w) => w.id === 'jobs')!;
const todo = MAIL_WORKSPACES.find((w) => w.id === 'todo')!;

const account = (over: Partial<CheckAccount> = {}): CheckAccount => ({
  id: 'a1',
  email_address: 'me@example.com',
  status: 'active',
  last_synced_at: '2026-11-06T11:58:00Z',
  backfill_completed_at: '2026-10-01T00:00:00Z',
  ...over,
});

const job = (over: Partial<CheckJob> = {}): CheckJob => ({
  email_account_id: 'a1',
  status: 'completed',
  error: null,
  linked: {},
  started_at: '2026-11-06T11:57:00Z',
  created_at: '2026-11-06T11:57:00Z',
  updated_at: '2026-11-06T11:58:00Z',
  ...over,
});

describe('addFanOut', () => {
  it('adds a batch to what the job holds and counts a linker that threw', () => {
    const first = addFanOut({}, {
      jobs: { claimed: 2, linked: 1, failed: 0 },
      commerce: { error: 'boom' },
    });
    const second = addFanOut(first, { jobs: { claimed: 1, linked: 0, failed: 1 } });
    expect(second.jobs).toEqual({ claimed: 3, linked: 1, failed: 1, errors: 0 });
    expect(second.commerce).toEqual({ claimed: 0, linked: 0, failed: 0, errors: 1 });
  });

  it('reads a stored value that is not an object as empty', () => {
    expect(addFanOut(null, undefined)).toEqual({});
    expect(addFanOut('nonsense', {})).toEqual({});
  });
});

describe('result lines', () => {
  it('says what a workspace found, across its linkers', () => {
    const linked = sumLinked([
      { appointments: { claimed: 1, linked: 1, failed: 0, errors: 0 } },
      { replies: { claimed: 2, linked: 0, failed: 0, errors: 0 } },
    ]);
    expect(resultLine(todo, workspaceCount(todo, linked))).toBe('3 new, 1 added to Todo');
  });

  it('says Nothing new for a workspace that took nothing', () => {
    expect(resultLine(jobs, workspaceCount(jobs, {}))).toBe('Nothing new');
  });

  it('names a linker that failed and found nothing', () => {
    expect(resultLine(jobs, { claimed: 0, linked: 0, failed: 0, errors: 1 })).toBe(
      'Could not finish sorting the mail',
    );
  });

  it('writes the brief example for Jobs', () => {
    expect(resultLine(jobs, { claimed: 2, linked: 1, failed: 0, errors: 0 })).toBe('2 new, 1 linked to a role');
  });
});

describe('mailWorkspacesFor', () => {
  it('keeps only the mail workspaces switched on, in the menu order, and never News', () => {
    expect(mailWorkspacesFor(['news', 'todo', 'jobs', 'vault']).map((w) => w.id)).toEqual(['jobs', 'todo']);
  });
});

describe('nextCheckAt', () => {
  it('holds the next check for a minute after the last started', () => {
    expect(nextCheckAt('2026-11-06T11:59:30Z', NOW)).toBe('2026-11-06T12:00:30.000Z');
    expect(nextCheckAt('2026-11-06T11:58:59Z', NOW)).toBeNull();
    expect(nextCheckAt(null, NOW)).toBeNull();
  });
});

describe('plainProblem', () => {
  it('asks for a reconnect when Google refuses the token', () => {
    expect(plainProblem('invalid_grant: Token has been expired or revoked.', 'me@example.com').kind).toBe(
      'reconnect',
    );
  });

  it('says to wait on a quota error', () => {
    expect(plainProblem('Gmail 429: User-rate limit exceeded').kind).toBe('quota');
  });
});

describe('mailCheckStatus', () => {
  it('adds up the latest check of each mailbox', () => {
    const status = mailCheckStatus(
      [account(), account({ id: 'a2', email_address: 'work@example.com', last_synced_at: '2026-11-06T11:59:00Z' })],
      [
        job({ linked: { jobs: { claimed: 1, linked: 1, failed: 0, errors: 0 } } }),
        job({ email_account_id: 'a2', linked: { jobs: { claimed: 1, linked: 0, failed: 0, errors: 0 } } }),
        // An older check of a1, which the latest replaces.
        job({ created_at: '2026-11-05T00:00:00Z', linked: { jobs: { claimed: 9, linked: 9, failed: 0, errors: 0 } } }),
      ],
      NOW,
    );
    expect(status.running).toBe(false);
    expect(status.lastCheckedAt).toBe('2026-11-06T11:59:00Z');
    expect(status.linked?.jobs).toEqual({ claimed: 2, linked: 1, failed: 0, errors: 0 });
    expect(status.nextAllowedAt).toBeNull();
  });

  it('reports a check under way and holds the next one', () => {
    const status = mailCheckStatus(
      [account()],
      [job({ status: 'running', started_at: '2026-11-06T11:59:40Z', updated_at: '2026-11-06T11:59:55Z' })],
      NOW,
    );
    expect(status.running).toBe(true);
    expect(status.nextAllowedAt).toBe('2026-11-06T12:00:40.000Z');
  });

  it('takes a running job nobody has touched for fifteen minutes as dead', () => {
    const status = mailCheckStatus(
      [account()],
      [job({ status: 'running', started_at: '2026-11-06T10:00:00Z', updated_at: '2026-11-06T10:00:00Z' })],
      NOW,
    );
    expect(status.running).toBe(false);
  });

  it('names a mailbox that needs reconnecting, one still importing, and a failed check', () => {
    const status = mailCheckStatus(
      [
        account({ id: 'a1', status: 'needs_reauth' }),
        account({ id: 'a2', email_address: 'new@example.com', backfill_completed_at: null }),
        account({ id: 'a3', email_address: 'busy@example.com' }),
      ],
      [job({ email_account_id: 'a3', status: 'failed', error: 'Quota exceeded for quota metric' })],
      NOW,
    );
    expect(status.problems.map((p) => p.kind)).toEqual(['reconnect', 'importing', 'quota']);
  });

  it('says there is no mailbox when none is connected', () => {
    expect(mailCheckStatus([], [], NOW).mailboxes).toBe(0);
  });
});
