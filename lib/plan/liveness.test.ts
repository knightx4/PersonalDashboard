import { describe, expect, it } from 'vitest';
import {
  abandonedClaim,
  claimIsLive,
  claimLiveness,
  ENDED_AFTER_MINUTES,
  lastPushSince,
  pushesFrom,
  QUIET_AFTER_MINUTES,
  readingTrusted,
  runEndedNote,
  runLiveness,
  silenceReads,
  type ActivityRow,
  type ClaimRun,
  type Push,
  type RunEvidence,
} from '@/lib/plan/liveness';
import { STALLED_AFTER_MINUTES } from '@/lib/plan/elapsed';

const NOW = Date.parse('2026-09-17T12:00:00Z');

/** An instant, as minutes before `NOW`, in the shape the rows carry. */
function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

function push(ref: string, minutes: number): Push {
  return { ref, sha: 'abc1234', at: minutesAgo(minutes) };
}

function evidence(over: Partial<RunEvidence> = {}): RunEvidence {
  return {
    startedAt: minutesAgo(30),
    lastPush: null,
    stepClosedAt: null,
    read: true,
    ...over,
  };
}

describe('pushesFrom', () => {
  const rows: ActivityRow[] = [
    { activity_type: 'push', ref: 'refs/heads/main', after: 'aaa', timestamp: minutesAgo(5) },
    {
      activity_type: 'branch_creation',
      ref: 'refs/heads/claude/festive-faraday-ut52vo',
      after: 'bbb',
      timestamp: minutesAgo(12),
    },
    { activity_type: 'branch_deletion', ref: 'refs/heads/old', after: 'ccc', timestamp: minutesAgo(8) },
    { activity_type: 'push', ref: 'refs/heads/main', after: 'ddd', timestamp: minutesAgo(90) },
  ];

  it('keeps every activity that moved a branch forward', () => {
    expect(pushesFrom(rows, NOW - 60 * 60_000).map((p) => p.ref)).toEqual([
      'main',
      'claude/festive-faraday-ut52vo',
    ]);
  });

  it('counts a branch being created, which is how a run first pushes', () => {
    const created = pushesFrom([rows[1]], 0);
    expect(created).toHaveLength(1);
    expect(created[0].sha).toBe('bbb');
  });

  it('leaves out a deletion, which moves nothing forward', () => {
    expect(pushesFrom([rows[2]], 0)).toEqual([]);
  });

  it('leaves out anything older than the instant asked about', () => {
    expect(pushesFrom(rows, NOW - 10 * 60_000).map((p) => p.ref)).toEqual(['main']);
  });

  it('ignores a row with no timestamp or no ref', () => {
    expect(pushesFrom([{ activity_type: 'push' }, { activity_type: 'push', ref: 'x' }], 0)).toEqual(
      [],
    );
  });
});

describe('lastPushSince', () => {
  const pushes = [push('main', 5), push('claude/one', 40), push('claude/two', 200)];

  it('takes the newest push after the run started', () => {
    expect(lastPushSince(pushes, minutesAgo(60))?.ref).toBe('main');
  });

  it('ignores a push from before the run was fired', () => {
    expect(lastPushSince([pushes[2]], minutesAgo(60))).toBeNull();
  });

  it('is null when nothing has been pushed at all', () => {
    expect(lastPushSince([], minutesAgo(60))).toBeNull();
  });
});

describe('runLiveness', () => {
  it('is working while something is still being pushed', () => {
    expect(runLiveness(evidence({ lastPush: push('claude/one', 3) }), NOW)).toBe('working');
  });

  it('is working before the quiet mark, with nothing pushed yet', () => {
    expect(runLiveness(evidence({ startedAt: minutesAgo(8) }), NOW)).toBe('working');
  });

  it('is quiet twenty minutes after the last push', () => {
    expect(runLiveness(evidence({ lastPush: push('claude/one', 25) }), NOW)).toBe('quiet');
  });

  it('is ended two hours after the last push', () => {
    expect(
      runLiveness(evidence({ startedAt: minutesAgo(300), lastPush: push('claude/one', 130) }), NOW),
    ).toBe('ended');
  });

  it('is ended two hours after a run that never pushed anything', () => {
    expect(runLiveness(evidence({ startedAt: minutesAgo(150) }), NOW)).toBe('ended');
  });

  it('is finished when the step it was sent at closed after it was fired', () => {
    expect(
      runLiveness(evidence({ startedAt: minutesAgo(300), stepClosedAt: minutesAgo(200) }), NOW),
    ).toBe('finished');
  });

  it('ignores a step that closed before this run started', () => {
    expect(
      runLiveness(evidence({ startedAt: minutesAgo(150), stepClosedAt: minutesAgo(400) }), NOW),
    ).toBe('ended');
  });

  it('is unknown when GitHub could not be asked', () => {
    expect(runLiveness(evidence({ startedAt: minutesAgo(300), read: false }), NOW)).toBe('unknown');
  });

  it('ages nothing at the clock pre-mount value', () => {
    expect(runLiveness(evidence({ startedAt: minutesAgo(300) }), 0)).toBe('working');
  });
});

describe('abandonedClaim', () => {
  it('is a claim still standing over a run that ended', () => {
    expect(abandonedClaim({ status: 'in_progress' }, 'ended')).toBe(true);
  });

  it('is not a claim whose run is merely quiet', () => {
    expect(abandonedClaim({ status: 'in_progress' }, 'quiet')).toBe(false);
  });

  it('is not a step nobody is claiming', () => {
    expect(abandonedClaim({ status: 'blocked' }, 'ended')).toBe(false);
    expect(abandonedClaim(null, 'ended')).toBe(false);
  });
});

describe('runEndedNote', () => {
  it('says what was last pushed, and how long ago', () => {
    expect(runEndedNote(evidence({ lastPush: push('claude/one', 125) }), NOW)).toBe(
      'Nothing has been pushed for 2h 5m. The last was claude/one.',
    );
  });

  it('says a run that never pushed anything never pushed anything', () => {
    expect(runEndedNote(evidence({ startedAt: minutesAgo(130) }), NOW)).toBe(
      'Nothing was pushed in the 2h 10m after this run started.',
    );
  });
});

/** A claim on a step, as the tree hands it over. */
function claim(over: Partial<{ status: string; startedAt: string | null }> = {}) {
  return { status: 'in_progress', startedAt: minutesAgo(30), ...over };
}

/**
 * The last run against it, with a reading GitHub gave `checked` minutes ago
 * and a last push `pushed` minutes ago.
 */
function run(over: Partial<ClaimRun> = {}): ClaimRun {
  return {
    status: 'started',
    createdAt: minutesAgo(30),
    reading: { checkedAt: minutesAgo(1), lastPush: null, refusal: null },
    ...over,
  };
}

function reading(checked: number, pushed: number | null, refusal: string | null = null) {
  return {
    checkedAt: minutesAgo(checked),
    lastPush: pushed === null ? null : { at: minutesAgo(pushed), sha: 'abc1234', subject: 'A push' },
    refusal,
  };
}

describe('silenceReads', () => {
  it('turns on the two marks #524 set, and nowhere else', () => {
    expect(silenceReads(QUIET_AFTER_MINUTES - 1)).toBe('working');
    expect(silenceReads(QUIET_AFTER_MINUTES)).toBe('quiet');
    expect(silenceReads(ENDED_AFTER_MINUTES - 1)).toBe('quiet');
    expect(silenceReads(ENDED_AFTER_MINUTES)).toBe('ended');
  });
});

describe('readingTrusted', () => {
  it('believes a reading taken inside the ended mark', () => {
    expect(readingTrusted(reading(ENDED_AFTER_MINUTES - 1, null), NOW)).toBe(true);
  });

  it('does not believe one older than that -- #570', () => {
    expect(readingTrusted(reading(ENDED_AFTER_MINUTES, null), NOW)).toBe(false);
  });

  it('does not believe one GitHub refused, however fresh', () => {
    expect(readingTrusted(reading(1, 2, '401 from GitHub'), NOW)).toBe(false);
  });

  it('believes anything at the clock pre-mount value', () => {
    expect(readingTrusted(reading(60 * 9, null), 0)).toBe(true);
  });
});

describe('claimLiveness', () => {
  it('is nothing at all on a step nobody has claimed', () => {
    for (const status of ['not_started', 'blocked', 'done', 'dropped', 'proposed']) {
      expect(claimLiveness(claim({ status }), run(), NOW)).toBeNull();
    }
  });

  it('is working while its run has pushed inside the quiet mark', () => {
    expect(claimLiveness(claim(), run({ reading: reading(1, 5) }), NOW)).toBe('working');
  });

  it('is quiet once nothing has been pushed for the quiet mark', () => {
    expect(
      claimLiveness(claim(), run({ reading: reading(1, QUIET_AFTER_MINUTES) }), NOW),
    ).toBe('quiet');
  });

  it('counts the silence from the run being fired when it never pushed', () => {
    expect(
      claimLiveness(
        claim({ startedAt: minutesAgo(5) }),
        run({ createdAt: minutesAgo(QUIET_AFTER_MINUTES), reading: reading(1, null) }),
        NOW,
      ),
    ).toBe('quiet');
  });

  it('is abandoned past the ended mark, with the step still open', () => {
    expect(
      claimLiveness(
        claim({ startedAt: minutesAgo(10) }),
        run({ createdAt: minutesAgo(200), reading: reading(1, ENDED_AFTER_MINUTES) }),
        NOW,
      ),
    ).toBe('abandoned');
  });

  it('is abandoned on a run already written off as failed', () => {
    expect(
      claimLiveness(claim({ startedAt: minutesAgo(5) }), run({ status: 'failed', reading: null }), NOW),
    ).toBe('abandoned');
  });

  describe('with nothing to read, it falls back to the clock in elapsed.ts', () => {
    it('is claimed while the claim is inside the two hours', () => {
      expect(claimLiveness(claim({ startedAt: minutesAgo(10) }), null, NOW)).toBe('claimed');
      expect(
        claimLiveness(claim({ startedAt: minutesAgo(10) }), run({ reading: null }), NOW),
      ).toBe('claimed');
    });

    it('is abandoned once the claim is past them', () => {
      expect(
        claimLiveness(claim({ startedAt: minutesAgo(STALLED_AFTER_MINUTES) }), null, NOW),
      ).toBe('abandoned');
    });

    it('ignores a reading older than the ended mark -- #570', () => {
      // The reading says pushing; it is too old to be worth repeating, so the
      // claim's own clock answers, and that clock has run out.
      expect(
        claimLiveness(
          claim({ startedAt: minutesAgo(STALLED_AFTER_MINUTES + 10) }),
          run({ createdAt: minutesAgo(200), reading: reading(ENDED_AFTER_MINUTES + 1, 1) }),
          NOW,
        ),
      ).toBe('abandoned');
    });

    it('ignores a reading GitHub refused, so a wrong key reads as nothing new', () => {
      expect(
        claimLiveness(
          claim({ startedAt: minutesAgo(10) }),
          run({ reading: reading(1, null, '401 from GitHub') }),
          NOW,
        ),
      ).toBe('claimed');
    });

    it('leaves a claim with no start time alone: the trigger has not stamped it yet', () => {
      expect(claimLiveness(claim({ startedAt: null }), null, 0)).toBe('claimed');
      expect(claimLiveness(claim({ startedAt: null }), null, NOW)).toBe('claimed');
    });
  });

  it('ages nothing at the clock pre-mount value', () => {
    expect(
      claimLiveness(
        claim({ startedAt: minutesAgo(60 * 9) }),
        run({ createdAt: minutesAgo(60 * 9), reading: reading(60 * 9, 60 * 9) }),
        0,
      ),
    ).toBe('working');
  });
});

describe('claimIsLive', () => {
  it('is what the send guard refuses on: everything but a run that ended', () => {
    expect(claimIsLive('working')).toBe(true);
    expect(claimIsLive('claimed')).toBe(true);
    // #574: quiet is re-sent by asking first, not by the guard giving way.
    expect(claimIsLive('quiet')).toBe(true);
    expect(claimIsLive('abandoned')).toBe(false);
    expect(claimIsLive(null)).toBe(false);
  });
});
