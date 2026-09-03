import { describe, expect, it } from 'vitest';
import { syncProgress, type SyncSnapshot } from '@/lib/core/inbox/progress';

function job(patch: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    status: 'running',
    phase: 'listing',
    messagesSeen: 0,
    messagesParsed: 0,
    messagesTotal: null,
    ...patch,
  };
}

describe('what a mailbox check is doing', () => {
  it('starts somewhere other than zero', () => {
    // A bar that sits at nothing while the run is genuinely working reads as a
    // run that has not started, which is the complaint this exists to answer.
    const view = syncProgress(job());
    expect(view.fraction).toBeGreaterThan(0);
    expect(view.detail).toBe('Looking for mail you have not seen yet.');
    expect(view.done).toBe(false);
  });

  it('moves with the count once the run knows how many there are', () => {
    const quarter = syncProgress(job({ phase: 'reading', messagesSeen: 5, messagesTotal: 20 }));
    const half = syncProgress(job({ phase: 'reading', messagesSeen: 10, messagesTotal: 20 }));

    expect(half.fraction).toBeGreaterThan(quarter.fraction);
    expect(half.detail).toBe('Reading 10 of 20 messages.');
  });

  it('says what it is doing when there is no count to give', () => {
    // A backfill page has no run-wide total, so the phases carry the bar.
    const view = syncProgress(job({ phase: 'reading', messagesSeen: 6, messagesTotal: null }));
    expect(view.detail).toBe('Reading what it found.');
    expect(view.fraction).toBeGreaterThan(0);
    expect(view.fraction).toBeLessThan(1);
  });

  it('never runs past the end when the count overshoots the total', () => {
    const view = syncProgress(job({ phase: 'reading', messagesSeen: 40, messagesTotal: 20 }));
    expect(view.fraction).toBeLessThan(1);
  });

  it('has a phase for the half of the run that has no count', () => {
    const view = syncProgress(job({ phase: 'linking', messagesSeen: 3, messagesTotal: 3 }));
    expect(view.detail).toBe('Sorting 3 messages into roles.');
    expect(view.done).toBe(false);
  });

  it('says plainly when a check found nothing', () => {
    const view = syncProgress(job({ status: 'completed', phase: 'done' }));
    expect(view).toMatchObject({
      fraction: 1,
      detail: 'Nothing new since the last check.',
      done: true,
      failed: false,
    });
  });

  it('says what a finished check actually did', () => {
    const view = syncProgress(
      job({ status: 'completed', phase: 'done', messagesSeen: 1, messagesParsed: 1 }),
    );
    expect(view.detail).toBe('Done — 1 message read, 1 linked.');
  });

  it('shows the error a failed run recorded', () => {
    const view = syncProgress(job({ status: 'failed', error: 'Gmail said no.' }));
    expect(view).toMatchObject({ detail: 'Gmail said no.', done: true, failed: true });
  });

  it('has something to say about a failure that recorded nothing', () => {
    const view = syncProgress(job({ status: 'failed', error: '  ' }));
    expect(view.detail).toBe('The check stopped before it finished.');
  });

  it('treats a run with no phase yet as one that has just started', () => {
    // Rows written before the column existed, and the moment between the
    // insert and the first write.
    const view = syncProgress(job({ phase: null }));
    expect(view.detail).toBe('Looking for mail you have not seen yet.');
  });
});
