import { describe, expect, it } from 'vitest';
import {
  MAIL_WORKSPACES,
  addFanOut,
  canStart,
  mailCheckStatus,
  mailWorkspacesFor,
  mailboxLine,
  mailboxResult,
  nextCheckAt,
  plainProblem,
  planCheck,
  workspaceCount,
  type CheckAccount,
  type CheckJob,
} from './mail-check';

const NOW = Date.parse('2026-11-06T12:00:00Z');
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

describe('mailboxResult', () => {
  it('counts what a mailbox brought in and names each workspace that took some', () => {
    const linked = {
      jobs: { claimed: 2, linked: 1, failed: 0, errors: 0 },
      commerce: { claimed: 1, linked: 1, failed: 0, errors: 0 },
    };
    expect(mailboxResult(MAIL_WORKSPACES, linked)).toBe('3 new · 2 in Jobs, 1 in Shopping');
  });

  it('adds up a workspace read by more than one linker', () => {
    const linked = {
      appointments: { claimed: 1, linked: 1, failed: 0, errors: 0 },
      replies: { claimed: 2, linked: 0, failed: 0, errors: 0 },
    };
    expect(workspaceCount(todo, linked).claimed).toBe(3);
    expect(mailboxResult(MAIL_WORKSPACES, linked)).toBe('3 new · 3 in Todo');
  });

  it('leaves out workspaces that are switched off', () => {
    const linked = { commerce: { claimed: 4, linked: 4, failed: 0, errors: 0 } };
    expect(mailboxResult(mailWorkspacesFor(['jobs']), linked)).toBe('Nothing new');
  });

  it('says Nothing new, and names a linker that failed', () => {
    expect(mailboxResult(MAIL_WORKSPACES, {})).toBe('Nothing new');
    expect(mailboxResult(MAIL_WORKSPACES, { jobs: { claimed: 0, linked: 0, failed: 0, errors: 1 } })).toBe(
      'Could not finish sorting the mail',
    );
  });
});

describe('mailboxLine', () => {
  it('keeps the breakdown when the whole line fits, and leaves it off rather than cut it', () => {
    const one = { jobs: { claimed: 1, linked: 1, failed: 0, errors: 0 } };
    expect(mailboxLine('Last checked 20 min ago', MAIL_WORKSPACES, one)).toBe(
      'Last checked 20 min ago · 1 new · 1 in Jobs',
    );
    const three = {
      jobs: { claimed: 2, linked: 1, failed: 0, errors: 0 },
      commerce: { claimed: 3, linked: 3, failed: 0, errors: 0 },
      appointments: { claimed: 1, linked: 1, failed: 0, errors: 0 },
    };
    expect(mailboxLine('Last checked 2 min ago', MAIL_WORKSPACES, three)).toBe('Last checked 2 min ago · 6 new');
    expect(mailboxLine('Checking…', MAIL_WORKSPACES, null)).toBe('Checking…');
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
    expect(plainProblem('invalid_grant: Token has been expired or revoked.').kind).toBe('reconnect');
  });

  it('says to wait on a quota error', () => {
    expect(plainProblem('Gmail 429: User-rate limit exceeded').kind).toBe('quota');
  });
});

describe('mailCheckStatus', () => {
  it('gives each mailbox its own latest check, last-checked time and result', () => {
    const status = mailCheckStatus(
      [account(), account({ id: 'a2', email_address: 'work@example.com', last_synced_at: '2026-11-06T11:59:00Z' })],
      [
        job({ linked: { jobs: { claimed: 1, linked: 1, failed: 0, errors: 0 } } }),
        job({ email_account_id: 'a2', linked: { jobs: { claimed: 4, linked: 0, failed: 0, errors: 0 } } }),
        // An older check of a1, which the latest replaces.
        job({ created_at: '2026-11-05T00:00:00Z', linked: { jobs: { claimed: 9, linked: 9, failed: 0, errors: 0 } } }),
      ],
      NOW,
    );
    expect(status.running).toBe(false);
    expect(status.mailboxes.map((m) => [m.email, m.lastCheckedAt, m.linked?.jobs.claimed])).toEqual([
      ['me@example.com', '2026-11-06T11:58:00Z', 1],
      ['work@example.com', '2026-11-06T11:59:00Z', 4],
    ]);
    expect(status.mailboxes.every(canStart)).toBe(true);
  });

  it('marks the one mailbox under way and holds only that one', () => {
    const status = mailCheckStatus(
      [account(), account({ id: 'a2', email_address: 'work@example.com' })],
      [job({ status: 'running', started_at: '2026-11-06T11:59:40Z', updated_at: '2026-11-06T11:59:55Z' })],
      NOW,
    );
    expect(status.running).toBe(true);
    const [first, second] = status.mailboxes;
    expect(first.running).toBe(true);
    expect(first.nextAllowedAt).toBe('2026-11-06T12:00:40.000Z');
    expect(canStart(first)).toBe(false);
    expect(canStart(second)).toBe(true);
  });

  it('takes a running job nobody has touched for fifteen minutes as dead', () => {
    const status = mailCheckStatus(
      [account()],
      [job({ status: 'running', started_at: '2026-11-06T10:00:00Z', updated_at: '2026-11-06T10:00:00Z' })],
      NOW,
    );
    expect(status.running).toBe(false);
  });

  it('puts each problem on its own mailbox', () => {
    const status = mailCheckStatus(
      [
        account({ id: 'a1', status: 'needs_reauth' }),
        account({ id: 'a2', email_address: 'new@example.com', backfill_completed_at: null }),
        account({ id: 'a3', email_address: 'busy@example.com' }),
      ],
      [job({ email_account_id: 'a3', status: 'failed', error: 'Quota exceeded for quota metric' })],
      NOW,
    );
    expect(status.mailboxes.map((m) => [m.id, m.problem?.kind, m.checkable])).toEqual([
      ['a1', 'reconnect', false],
      ['a2', 'importing', false],
      ['a3', 'quota', true],
    ]);
  });

  it('has no mailboxes when none is connected', () => {
    expect(mailCheckStatus([], [], NOW).mailboxes).toEqual([]);
  });
});

describe('planCheck', () => {
  const two = (jobs: CheckJob[]) =>
    mailCheckStatus([account(), account({ id: 'a2', email_address: 'work@example.com' })], jobs, NOW);
  const runningA1 = job({ status: 'running', started_at: '2026-11-06T11:59:40Z', updated_at: '2026-11-06T11:59:55Z' });

  it('starts only the mailbox whose button was pressed', () => {
    expect(planCheck(two([]), 'a2')).toEqual({ kind: 'start', ids: ['a2'], joined: false });
  });

  it('starts every mailbox for Check all, joining one already under way', () => {
    expect(planCheck(two([]), null)).toEqual({ kind: 'start', ids: ['a1', 'a2'], joined: false });
    expect(planCheck(two([runningA1]), null)).toEqual({ kind: 'start', ids: ['a2'], joined: true });
  });

  it('joins a mailbox already being checked rather than starting it again', () => {
    expect(planCheck(two([runningA1]), 'a1')).toEqual({ kind: 'joined' });
  });

  it('holds a mailbox checked under a minute ago, naming it', () => {
    const recent = job({ started_at: '2026-11-06T11:59:30Z', created_at: '2026-11-06T11:59:30Z' });
    expect(planCheck(two([recent]), 'a1')).toEqual({
      kind: 'wait',
      message: 'me@example.com was checked under a minute ago.',
    });
  });

  it('refuses a mailbox that is not connected or cannot be checked', () => {
    expect(planCheck(two([]), 'nope').kind).toBe('none');
    const reauth = mailCheckStatus([account({ status: 'needs_reauth' })], [], NOW);
    expect(planCheck(reauth, 'a1').kind).toBe('none');
    expect(planCheck(reauth, null).kind).toBe('none');
  });
});
