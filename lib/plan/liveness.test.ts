import { describe, expect, it } from 'vitest';
import {
  abandonedClaim,
  lastPushSince,
  pushesFrom,
  runEndedNote,
  runLiveness,
  type ActivityRow,
  type Push,
  type RunEvidence,
} from '@/lib/plan/liveness';

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
