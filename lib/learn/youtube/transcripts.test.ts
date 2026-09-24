import { describe, expect, it } from 'vitest';
import { afterFailure, decodeTranscript, encodeTranscript, storagePathFor } from '@/lib/learn/youtube/transcripts';

const NOW = new Date('2026-09-24T12:00:00Z');

function failure(outcome: 'no-transcript' | 'out-of-credits' | 'unauthorized' | 'rate-limited' | 'error', retryable = false) {
  return { ok: false as const, outcome, status: 0, credits: 0 as const, retryable, detail: outcome };
}

describe('the stored file', () => {
  it('round-trips the cues through gzip', () => {
    const cues = [
      { startSeconds: 8, endSeconds: 13.519, text: "Hi. This is the first lecture in MIT's course 18.06," },
      { startSeconds: 14, endSeconds: null, text: "linear algebra, and I'm Gilbert Strang." },
    ];
    const bytes = encodeTranscript('ZK3O402wf1c', 'en', cues, NOW);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(decodeTranscript(bytes)).toEqual({
      language: 'en',
      cues: [
        { startSeconds: 8, endSeconds: 13.52, text: cues[0].text },
        { startSeconds: 14, endSeconds: null, text: cues[1].text },
      ],
    });
  });

  it('lives under one path per video', () => {
    expect(storagePathFor('ZK3O402wf1c')).toBe('youtube/ZK3O402wf1c.json.gz');
  });
});

describe('afterFailure', () => {
  it('marks a video with no captions and looks again in a month', () => {
    const { update, stopRun } = afterFailure(failure('no-transcript'), 0, NOW);
    expect(update.state).toBe('none');
    expect(update.retry_after).toBe('2026-10-24T12:00:00.000Z');
    expect(stopRun).toBe(false);
  });

  it('stops the run on an account problem and keeps the video queued', () => {
    for (const outcome of ['out-of-credits', 'unauthorized'] as const) {
      const { update, stopRun } = afterFailure(failure(outcome), 2, NOW);
      expect(update.state).toBe('queued');
      expect(update.attempts).toBe(2);
      expect(stopRun).toBe(true);
    }
  });

  it('backs off a temporary failure and counts the attempt', () => {
    const first = afterFailure(failure('error', true), 0, NOW);
    expect(first.update).toMatchObject({ state: 'failed', attempts: 1, retry_after: '2026-09-24T13:00:00.000Z' });
    expect(first.stopRun).toBe(false);

    const third = afterFailure(failure('error', true), 2, NOW);
    expect(third.update.retry_after).toBe('2026-09-25T12:00:00.000Z');
  });

  it('stops the run on a rate limit, since the next video would meet the same one', () => {
    expect(afterFailure(failure('rate-limited', true), 0, NOW).stopRun).toBe(true);
  });

  it('does not schedule a retry for an error that will not change', () => {
    expect(afterFailure(failure('error', false), 0, NOW).update.retry_after).toBeNull();
  });
});
