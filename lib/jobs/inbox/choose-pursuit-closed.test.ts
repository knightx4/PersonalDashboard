/**
 * Which pursuit an inferred message belongs to once closed pursuits and the
 * ATS job id count.
 *
 * The cases come from the live data: a rescan of old mail on 30 September
 * gave Uber's job 159366 two new roles beside the rejected one, and STO
 * Building Group three roles each a second time, because only open pursuits
 * were looked at and the job id never was. These drive choosePursuitFor and
 * pursuitsFromRoles directly, on the row shapes the roles query returns,
 * because the fake database the sync tests use does not join applications to
 * roles.
 */
import { describe, expect, it } from 'vitest';
import {
  choosePursuitFor,
  oneAtATime,
  PLACEHOLDER_ROLE_TITLE,
  pursuitsFromRoles,
  type KnownPursuit,
  type PursuitMessage,
} from '@/lib/jobs/inbox/ingest-messages';

function known(over: Partial<KnownPursuit> = {}): KnownPursuit {
  return {
    roleId: 'r-1',
    roleTitle: 'Sr Associate, Strategic Finance',
    applicationId: 'a-1',
    atsJobId: null,
    closed: true,
    closedAt: new Date('2026-09-03T18:12:50Z'),
    createdAt: new Date('2026-09-04T12:34:09Z'),
    ...over,
  };
}

function message(over: Partial<PursuitMessage> = {}): PursuitMessage {
  return {
    title: 'Sr Associate, Strategic Finance',
    atsJobId: null,
    receivedAt: new Date('2026-08-06T03:58:04Z'),
    startsPursuit: true,
    ...over,
  };
}

describe('the ATS job id', () => {
  it('adopts the closed pursuit for the same posting when the mail is older than its close', () => {
    // STO 210766281: rejected on 6 September, then an 8 August confirmation rescanned.
    const sto = known({ atsJobId: '210766281', roleTitle: 'Financial Planning & Analysis, Associate' });
    expect(
      choosePursuitFor([sto], message({ title: 'FP&A Associate', atsJobId: '210766281' })),
    ).toEqual({ kind: 'adopt', applicationId: 'a-1' });
  });

  it('matches the job id even where the titles differ', () => {
    const open = known({ closed: false, closedAt: null, atsJobId: '159366', roleTitle: 'Growth Finance' });
    expect(choosePursuitFor([open], message({ atsJobId: ' 159366 ' }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('prefers an open attempt at the posting over a closed one', () => {
    const closed = known({ atsJobId: '42' });
    const open = known({ roleId: 'r-2', applicationId: 'a-2', atsJobId: '42', closed: false, closedAt: null });
    expect(choosePursuitFor([closed, open], message({ atsJobId: '42' }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-2',
    });
  });

  it('adopts the latest closed attempt when there are several', () => {
    const first = known({ atsJobId: '42', createdAt: new Date('2026-06-01T00:00:00Z') });
    const second = known({
      roleId: 'r-2',
      applicationId: 'a-2',
      atsJobId: '42',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      closedAt: new Date('2026-09-10T00:00:00Z'),
    });
    expect(choosePursuitFor([first, second], message({ atsJobId: '42' }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-2',
    });
  });

  it('does not let a title match cross to a different posting', () => {
    const other = known({ atsJobId: '1' });
    expect(choosePursuitFor([other], message({ atsJobId: '2' }))).toEqual({ kind: 'create' });
  });
});

describe('a closed pursuit with the same title', () => {
  it('takes the old confirmation a rescan found (the Uber case)', () => {
    // Rejected 3 September; the 6 August confirmation carries a job id the rejected row lacks.
    expect(choosePursuitFor([known()], message({ atsJobId: '159366' }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('takes a rejection that arrives after the close, since it continues the pursuit', () => {
    expect(
      choosePursuitFor(
        [known()],
        message({ startsPursuit: false, receivedAt: new Date('2026-10-01T00:00:00Z') }),
      ),
    ).toEqual({ kind: 'adopt', applicationId: 'a-1' });
  });

  it('takes a message with no date, which cannot show it came later', () => {
    expect(choosePursuitFor([known()], message({ receivedAt: null }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('ignores case and surrounding space', () => {
    expect(choosePursuitFor([known()], message({ title: '  sr associate, strategic finance ' }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });

  it('is never matched by a placeholder title', () => {
    const placeholder = known({ roleTitle: PLACEHOLDER_ROLE_TITLE });
    expect(choosePursuitFor([placeholder], message({ title: PLACEHOLDER_ROLE_TITLE }))).toEqual({
      kind: 'create',
    });
  });

  it('is not matched by a different title', () => {
    expect(choosePursuitFor([known()], message({ title: 'Controller' }))).toEqual({ kind: 'create' });
  });
});

describe('a genuine re-application', () => {
  const later = new Date('2026-10-01T09:00:00Z');

  it('still opens its own pursuit, by title', () => {
    expect(choosePursuitFor([known()], message({ receivedAt: later }))).toEqual({ kind: 'create' });
  });

  it('still opens its own pursuit, by job id', () => {
    expect(
      choosePursuitFor([known({ atsJobId: '42' })], message({ atsJobId: '42', receivedAt: later })),
    ).toEqual({ kind: 'create' });
  });

  it('names an open placeholder rather than opening a twin', () => {
    // The re-application's own earlier, untitled mail made the placeholder.
    const placeholder = known({
      roleId: 'r-p',
      applicationId: 'a-p',
      roleTitle: PLACEHOLDER_ROLE_TITLE,
      closed: false,
      closedAt: null,
    });
    expect(choosePursuitFor([known(), placeholder], message({ receivedAt: later }))).toEqual({
      kind: 'rename',
      applicationId: 'a-p',
      roleId: 'r-p',
    });
  });

  it('adopts a closed pursuit whose close was never recorded', () => {
    expect(choosePursuitFor([known({ closedAt: null })], message({ receivedAt: later }))).toEqual({
      kind: 'adopt',
      applicationId: 'a-1',
    });
  });
});

describe('the open pursuits', () => {
  it('keep their rules: an exact open title wins over a closed one', () => {
    const open = known({ roleId: 'r-2', applicationId: 'a-2', closed: false, closedAt: null });
    expect(choosePursuitFor([known(), open], message())).toEqual({ kind: 'adopt', applicationId: 'a-2' });
  });
});

describe('pursuitsFromRoles', () => {
  it('reads the live attempt where there is one, and the latest attempt where all have closed', () => {
    const pursuits = pursuitsFromRoles([
      {
        id: 'r-open',
        title: 'Analyst',
        ats_job_id: '7',
        created_at: '2026-09-01T00:00:00Z',
        applications: [
          { id: 'a-old', status: 'rejected', attempt: 1, closed_at: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
          { id: 'a-live', status: 'applied', attempt: 2, closed_at: null, created_at: '2026-09-01T00:00:00Z' },
        ],
      },
      {
        id: 'r-closed',
        title: 'Controller',
        ats_job_id: null,
        created_at: '2026-06-01T00:00:00Z',
        applications: [
          { id: 'a-1', status: 'rejected', attempt: 1, closed_at: '2026-06-20T00:00:00Z', created_at: '2026-06-01T00:00:00Z' },
          { id: 'a-2', status: 'ghosted', attempt: 2, closed_at: '2026-08-20T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
        ],
      },
      { id: 'r-empty', title: 'Nothing', applications: [] },
    ]);

    expect(pursuits).toEqual([
      {
        roleId: 'r-open',
        roleTitle: 'Analyst',
        applicationId: 'a-live',
        atsJobId: '7',
        closed: false,
        closedAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
      {
        roleId: 'r-closed',
        roleTitle: 'Controller',
        applicationId: 'a-2',
        atsJobId: null,
        closed: true,
        closedAt: new Date('2026-08-20T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    ]);
  });
});

describe('oneAtATime', () => {
  it('runs work for one key in order, so the second look sees the first one\'s row', async () => {
    const locks = new Map<string, Promise<void>>();
    const roles: string[] = [];
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

    // What createInferredApplication does: look, wait on the database, then insert if nothing was there.
    const lookThenCreate = (name: string) =>
      oneAtATime(
        'user:uber',
        async () => {
          const found = roles.length > 0;
          await tick();
          if (!found) roles.push(name);
          return found ? 'adopted' : 'created';
        },
        locks,
      );

    const outcomes = await Promise.all([lookThenCreate('first'), lookThenCreate('second')]);
    expect(outcomes).toEqual(['created', 'adopted']);
    expect(roles).toEqual(['first']);
    expect(locks.size).toBe(0);
  });

  it('lets different keys run side by side', async () => {
    const locks = new Map<string, Promise<void>>();
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const a = oneAtATime(
      'a',
      () =>
        new Promise<void>((resolve) => {
          releaseA = () => {
            order.push('a');
            resolve();
          };
        }),
      locks,
    );
    await oneAtATime('b', async () => order.push('b'), locks);
    releaseA();
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  it('releases the key when the work throws', async () => {
    const locks = new Map<string, Promise<void>>();
    await expect(oneAtATime('k', async () => Promise.reject(new Error('no')), locks)).rejects.toThrow('no');
    expect(await oneAtATime('k', async () => 'next', locks)).toBe('next');
    expect(locks.size).toBe(0);
  });
});
