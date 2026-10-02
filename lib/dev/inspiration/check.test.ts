import { describe, expect, it, vi } from 'vitest';
import { CHECK_LOCK_MS, checkRunning, runInspirationCheck, type CheckSteps } from './check';
import type { InspirationRead } from './read';
import type { InspirationSync } from './sync';

const NOW = new Date('2026-10-02T14:35:00Z');

const synced = (userId: string): InspirationSync => ({
  userId,
  playlistId: 'PLabcdefghij',
  onPlaylist: 1,
  added: 1,
  left: 0,
  back: 0,
  unavailable: 0,
  transcripts: null,
  withTranscript: 1,
  error: null,
});

const read = (userId: string): InspirationRead => ({
  userId,
  read: 1,
  takeaways: 2,
  merged: 0,
  covered: 0,
  failed: 0,
  stopped: null,
});

/** Steps over one in-memory claim, as the column holds it. */
function memorySteps(overrides: Partial<CheckSteps> = {}) {
  let claimedAt: Date | null = null;
  const steps: CheckSteps = {
    claim: vi.fn(async (_userId: string, at: Date) => {
      if (claimedAt && at.getTime() - claimedAt.getTime() < CHECK_LOCK_MS) return false;
      claimedAt = at;
      return true;
    }),
    release: vi.fn(async (_userId: string, at: Date) => {
      if (claimedAt?.getTime() === at.getTime()) claimedAt = null;
    }),
    sync: vi.fn(async (userId: string) => synced(userId)),
    read: vi.fn(async (userId: string) => read(userId)),
    ...overrides,
  };
  return { steps, held: () => claimedAt };
}

describe('runInspirationCheck', () => {
  it('syncs, then reads and merges, under the claim, and clears it after', async () => {
    const { steps, held } = memorySteps();
    const result = await runInspirationCheck(steps, 'u1', NOW);
    expect(result).toEqual({ userId: 'u1', ran: true, sync: synced('u1'), read: read('u1'), error: null });
    expect(steps.sync).toHaveBeenCalledBefore(steps.read as ReturnType<typeof vi.fn>);
    expect(held()).toBeNull();
  });

  it('does nothing while another check holds the claim, so no video is read twice', async () => {
    const { steps } = memorySteps();
    await steps.claim('u1', NOW);
    const result = await runInspirationCheck(steps, 'u1', new Date(NOW.getTime() + 60_000));
    expect(result).toEqual({ userId: 'u1', ran: false, reason: 'running' });
    expect(steps.sync).not.toHaveBeenCalled();
    expect(steps.read).not.toHaveBeenCalled();
  });

  it('takes over a claim old enough to be a run that died', async () => {
    const { steps } = memorySteps();
    await steps.claim('u1', NOW);
    const result = await runInspirationCheck(steps, 'u1', new Date(NOW.getTime() + CHECK_LOCK_MS + 1));
    expect(result.ran).toBe(true);
  });

  it('still reads what an earlier run fetched when the playlist read fails', async () => {
    const { steps, held } = memorySteps({
      sync: vi.fn(async () => {
        throw new Error('YouTube is down');
      }),
    });
    const result = await runInspirationCheck(steps, 'u1', NOW);
    expect(result).toMatchObject({ ran: true, sync: null, read: read('u1'), error: 'YouTube is down' });
    expect(held()).toBeNull();
  });

  it('clears the claim when the read throws', async () => {
    const { steps, held } = memorySteps({
      read: vi.fn(async () => {
        throw new Error('model refused');
      }),
    });
    const result = await runInspirationCheck(steps, 'u1', NOW);
    expect(result).toMatchObject({ ran: true, error: 'model refused' });
    expect(held()).toBeNull();
  });

  it('syncs without reading when there is no model key', async () => {
    const { steps } = memorySteps({ read: null });
    const result = await runInspirationCheck(steps, 'u1', NOW);
    expect(result).toMatchObject({ ran: true, sync: synced('u1'), read: null, error: null });
  });
});

describe('checkRunning', () => {
  it('holds for ten minutes from the claim, and not after', () => {
    expect(checkRunning(null, NOW)).toBe(false);
    expect(checkRunning(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe(true);
    expect(checkRunning(new Date(NOW.getTime() - CHECK_LOCK_MS).toISOString(), NOW)).toBe(false);
    expect(checkRunning('not a date', NOW)).toBe(false);
  });
});
