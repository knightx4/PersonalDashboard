import { describe, expect, it, vi } from 'vitest';
import { sweepLinkers, type DomainLinker } from '@/lib/core/inbox/fan-out';

const OPTS = {
  userId: 'u-1',
  accountId: 'a-1',
  accountEmail: 'me@example.com',
  accessToken: 'token',
  budgetMs: 10_000,
};

function linker(domain: string, sweep?: DomainLinker['sweep']): DomainLinker {
  return {
    domain,
    sweep,
    link: async () => {
      throw new Error('link should not run during a sweep');
    },
  };
}

describe('the held-queue sweep', () => {
  it('runs every linker that has one, and skips those that do not', async () => {
    const jobs = vi.fn(async () => {});
    await sweepLinkers([linker('commerce'), linker('jobs', jobs)], OPTS);
    expect(jobs).toHaveBeenCalledTimes(1);
  });

  it('hands each linker the remaining budget, not the whole one', async () => {
    const seen: number[] = [];
    const slow: DomainLinker['sweep'] = async ({ budgetMs }) => {
      seen.push(budgetMs);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    await sweepLinkers([linker('commerce', slow), linker('jobs', slow)], {
      ...OPTS,
      budgetMs: 1_000,
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeLessThan(seen[0]);
  });

  it('stops once the budget is gone rather than overrunning the hand-off', async () => {
    // Overrunning is not a slow sweep -- it is a dead chain: the invocation is
    // killed before it can call the next one, and the whole scan stops.
    const second = vi.fn(async () => {});
    await sweepLinkers(
      [
        linker('commerce', async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }),
        linker('jobs', second),
      ],
      { ...OPTS, budgetMs: 20 },
    );
    expect(second).not.toHaveBeenCalled();
  });

  it('lets one workspace fail without costing the other its sweep', async () => {
    const jobs = vi.fn(async () => {});
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sweepLinkers(
      [
        linker('commerce', async () => {
          throw new Error('commerce blew up');
        }),
        linker('jobs', jobs),
      ],
      OPTS,
    );
    expect(jobs).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
