import { describe, expect, it } from 'vitest';
import {
  abandonedClaim,
  claimIsLive,
  claimLiveness,
  commitSubject,
  ENDED_AFTER_MINUTES,
  lastPushSince,
  lastStoredPush,
  pushesFrom,
  QUIET_AFTER_MINUTES,
  quietRunNote,
  quietSendAsk,
  readingTrusted,
  refusalStanding,
  runEndedNote,
  runLiveness,
  runReplacedNote,
  sendOverClaim,
  silenceReads,
  SUBJECT_LIMIT,
  underwayRefusal,
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
    {
      activity_type: 'branch_deletion',
      ref: 'refs/heads/old',
      after: 'ccc',
      timestamp: minutesAgo(8),
    },
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

/**
 * The night's last push, read off the readings on the run rows rather than
 * asked of GitHub -- which is what the Overnight card draws (#633 on #568's
 * columns).
 */
describe('lastStoredPush', () => {
  const stored = (at: number | null, subject = 'A push', refusal: string | null = null) => ({
    reading: {
      checkedAt: minutesAgo(1),
      lastPush: at === null ? null : { at: minutesAgo(at), sha: 'abc1234', subject },
      refusal,
    },
  });

  it('takes the newest push any of the runs recorded', () => {
    expect(
      lastStoredPush([stored(40), stored(5, 'The newest'), stored(90)], minutesAgo(120))?.subject,
    ).toBe('The newest');
  });

  it('ignores a push from before the night started', () => {
    expect(lastStoredPush([stored(200)], minutesAgo(120))).toBeNull();
  });

  it('has nothing to say for a run nobody asked about, or one that pushed nothing', () => {
    expect(lastStoredPush([{ reading: null }, stored(null)], minutesAgo(120))).toBeNull();
  });

  it('passes over a refused reading rather than counting it as silence', () => {
    // A refusal carries no push at all, so the run under it answers instead.
    const refused = { reading: { checkedAt: minutesAgo(1), lastPush: null, refusal: '403' } };
    expect(
      lastStoredPush([refused, stored(5, 'The one that read')], minutesAgo(120))?.subject,
    ).toBe('The one that read');
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

  it('gives up on a run that pushed nothing at all after half an hour', () => {
    // A session shows up on the activity listing the moment it creates its
    // branch, so half an hour of nothing is not a quiet session -- it is one
    // that never started, and there is nothing of its work to lose.
    expect(runLiveness(evidence({ startedAt: minutesAgo(35) }), NOW)).toBe('ended');
  });

  it('still waits the full two hours once a run has pushed something', () => {
    // The same half hour, but this one got its branch up. Firing a second
    // session at the feature it is working is worse than waiting for it.
    expect(
      runLiveness(evidence({ startedAt: minutesAgo(35), lastPush: push('claude/one', 32) }), NOW),
    ).toBe('quiet');
  });

  it('keeps a run that has pushed nothing but is not yet half an hour old', () => {
    expect(runLiveness(evidence({ startedAt: minutesAgo(25) }), NOW)).toBe('quiet');
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
    lastPush:
      pushed === null ? null : { at: minutesAgo(pushed), sha: 'abc1234', subject: 'A push' },
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

/**
 * The other half of setting a refusal aside: saying it is there.
 *
 * `readingTrusted` refuses to read silence the key caused as evidence.
 * `refusalStanding` is what #566 says instead, and it is the only thing here
 * that a refusal makes truer rather than less true.
 */
describe('refusalStanding', () => {
  it('is the reason, while the reading is recent', () => {
    expect(refusalStanding(reading(1, null, '403 from GitHub'), NOW)).toBe('403 from GitHub');
  });

  it('is nothing on a reading GitHub answered, and nothing with no reading', () => {
    expect(refusalStanding(reading(1, 2), NOW)).toBeNull();
    expect(refusalStanding(null, NOW)).toBeNull();
    expect(refusalStanding(undefined, NOW)).toBeNull();
  });

  it('is nothing past the trusted mark, since nothing has asked since', () => {
    expect(refusalStanding(reading(ENDED_AFTER_MINUTES, null, '403'), NOW)).toBeNull();
    expect(refusalStanding(reading(ENDED_AFTER_MINUTES - 1, null, '403'), NOW)).toBe('403');
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
    expect(claimLiveness(claim(), run({ reading: reading(1, QUIET_AFTER_MINUTES) }), NOW)).toBe(
      'quiet',
    );
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
      claimLiveness(
        claim({ startedAt: minutesAgo(5) }),
        run({ status: 'failed', reading: null }),
        NOW,
      ),
    ).toBe('abandoned');
  });

  describe('with nothing to read, it falls back to the clock in elapsed.ts', () => {
    it('is claimed while the claim is inside the two hours', () => {
      expect(claimLiveness(claim({ startedAt: minutesAgo(10) }), null, NOW)).toBe('claimed');
      expect(claimLiveness(claim({ startedAt: minutesAgo(10) }), run({ reading: null }), NOW)).toBe(
        'claimed',
      );
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
      // The third line of #566's done-when, from the other side: the run has
      // been silent for half an hour, which is past the quiet mark, and the
      // only reason nothing was heard is that the key was refused. A rejected
      // key must not be able to make a working session look quiet, so the
      // clock answers and the claim reads as a claim.
      const reads = claimLiveness(
        claim({ startedAt: minutesAgo(10) }),
        run({ createdAt: minutesAgo(30), reading: reading(1, null, '401 from GitHub') }),
        NOW,
      );
      expect(reads).not.toBe('quiet');
      expect(reads).toBe('claimed');
    });

    it('still ends a refused claim on the clock once it is past the two hours', () => {
      // The fallback is the clock, not silence -- so a refusal does not keep a
      // claim standing for ever either.
      expect(
        claimLiveness(
          claim({ startedAt: minutesAgo(200) }),
          run({ createdAt: minutesAgo(200), reading: reading(1, null, '401 from GitHub') }),
          NOW,
        ),
      ).toBe('abandoned');
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
    // #587: and it goes on refusing every other step under the same feature.
    expect(claimIsLive('quiet')).toBe(true);
    expect(claimIsLive('abandoned')).toBe(false);
    expect(claimIsLive(null)).toBe(false);
  });
});

describe('commitSubject', () => {
  it('takes the subject and leaves the body behind', () => {
    expect(
      commitSubject('Show what the night has done so far (plan #633)\n\nThe reasoning, at length.'),
    ).toBe('Show what the night has done so far (plan #633)');
  });

  it('has nothing to say about a commit with no message', () => {
    expect(commitSubject('')).toBeNull();
    expect(commitSubject('\n\nbody only')).toBeNull();
  });

  it('cuts a long subject at a word, and says it cut it', () => {
    const said = commitSubject('a'.repeat(20) + ' ' + 'b'.repeat(200));
    expect(said).toMatch(/…$/);
    expect(said!.length).toBeLessThanOrEqual(SUBJECT_LIMIT + 1);
    expect(said).not.toContain('b'.repeat(200));
  });
});

describe('quietRunNote', () => {
  it('says how long the silence has run and what the last push was', () => {
    expect(quietRunNote(run({ createdAt: minutesAgo(90), reading: reading(1, 35) }), NOW)).toBe(
      'Nothing has been pushed for 35m. The last was "A push".',
    );
  });

  it('names the commit when the push was recorded without its subject', () => {
    expect(
      quietRunNote(
        run({
          reading: {
            checkedAt: minutesAgo(1),
            lastPush: { at: minutesAgo(25), sha: 'abc1234def', subject: null },
            refusal: null,
          },
        }),
        NOW,
      ),
    ).toBe('Nothing has been pushed for 25m. The last was abc1234.');
  });

  it('counts from the press when the run never pushed at all', () => {
    expect(quietRunNote(run({ createdAt: minutesAgo(40), reading: reading(1, null) }), NOW)).toBe(
      'Nothing has been pushed in the 40m since it started.',
    );
  });
});

describe('quietSendAsk', () => {
  it('is a question, and it carries the evidence rather than the verdict', () => {
    const ask = quietSendAsk(586, run({ createdAt: minutesAgo(90), reading: reading(1, 35) }), NOW);
    expect(ask).toContain('#586');
    expect(ask).toContain('35m');
    expect(ask).toContain('A push');
    expect(ask.endsWith('?')).toBe(true);
  });
});

describe('runReplacedNote', () => {
  it('says the run was replaced and what it had managed first', () => {
    const note = runReplacedNote(run({ reading: reading(1, 35) }), NOW);
    expect(note).toContain('handed to a fresh session');
    expect(note).toContain('35m');
  });
});

describe('sendOverClaim', () => {
  const quietRun = run({ createdAt: minutesAgo(90), reading: reading(1, 35) });

  it('sends a step nothing is claiming', () => {
    expect(
      sendOverClaim({ number: 1, liveness: null, run: null, now: NOW, confirmed: false }),
    ).toEqual({
      send: true,
    });
  });

  it('sends a step whose run has stopped, without asking', () => {
    expect(
      sendOverClaim({
        number: 1,
        liveness: 'abandoned',
        run: quietRun,
        now: NOW,
        confirmed: false,
      }),
    ).toEqual({ send: true });
  });

  it('asks before sending a step whose run has gone quiet', () => {
    const verdict = sendOverClaim({
      number: 586,
      liveness: 'quiet',
      run: quietRun,
      now: NOW,
      confirmed: false,
    });
    expect(verdict.send).toBe(false);
    if (verdict.send) throw new Error('unreachable');
    expect(verdict.confirmable).toBe(true);
    expect(verdict.ask).toBe(quietSendAsk(586, quietRun, NOW));
  });

  it('sends that same step once the question has been answered', () => {
    expect(
      sendOverClaim({ number: 586, liveness: 'quiet', run: quietRun, now: NOW, confirmed: true }),
    ).toEqual({ send: true });
  });

  it('refuses a run that is still pushing, and confirming does not get past it', () => {
    for (const confirmed of [false, true]) {
      const verdict = sendOverClaim({
        number: 586,
        liveness: 'working',
        run: run({ reading: reading(1, 2) }),
        now: NOW,
        confirmed,
      });
      expect(verdict.send).toBe(false);
      if (verdict.send) throw new Error('unreachable');
      expect(verdict.confirmable).toBe(false);
      expect(verdict.ask).toContain('already underway');
    }
  });

  it('refuses a claim nothing has been read about, the way it always has', () => {
    const verdict = sendOverClaim({
      number: 586,
      liveness: 'claimed',
      run: null,
      now: NOW,
      confirmed: true,
    });
    expect(verdict.send).toBe(false);
    if (verdict.send) throw new Error('unreachable');
    expect(verdict.confirmable).toBe(false);
  });
});

describe('underwayRefusal', () => {
  const quietRun = run({ createdAt: minutesAgo(90), reading: reading(1, 35) });

  it('names the sibling holding the feature and how long it has been silent', () => {
    expect(
      underwayRefusal({
        press: 'step',
        number: 591,
        title: 'Draw the run on the row',
        liveness: 'quiet',
        run: quietRun,
        now: NOW,
      }),
    ).toBe(
      '#591 Draw the run on the row is underway under the same feature. ' +
        'Nothing has been pushed for 35m. The last was "A push". ' +
        'Wait for it, or put it back to not started if its session is gone.',
    );
  });

  it('says where the claim is differently when the whole feature was pressed', () => {
    const said = underwayRefusal({
      press: 'feature',
      number: 591,
      title: 'Draw the run on the row',
      liveness: 'quiet',
      run: quietRun,
      now: NOW,
    });
    expect(said).toContain('#591 Draw the run on the row is already underway.');
    expect(said).toContain('35m');
    expect(said).not.toContain('under the same feature');
  });

  it('leaves a claim nothing has been read about reading exactly as it did', () => {
    for (const press of ['step', 'feature'] as const) {
      expect(
        underwayRefusal({
          press,
          number: 591,
          title: 'Draw it',
          liveness: 'claimed',
          run: null,
          now: NOW,
        }),
      ).toBe(
        press === 'step'
          ? '#591 Draw it is underway under the same feature. ' +
              'Wait for it, or put it back to not started if its session is gone.'
          : '#591 Draw it is already underway. ' +
              'Wait for it, or put it back to not started if its session is gone.',
      );
    }
  });

  it('says nothing about silence for a run that is still pushing', () => {
    expect(
      underwayRefusal({
        press: 'step',
        number: 591,
        title: 'Draw it',
        liveness: 'working',
        run: run({ reading: reading(1, 2) }),
        now: NOW,
      }),
    ).not.toContain('Nothing has been pushed');
  });

  it('is never a question, however quiet the run is', () => {
    // #587's answer (b): quiet frees the step its run was sent at and nothing
    // else, so this refusal has no confirmation behind it the way `sendOverClaim`
    // does.
    const said = underwayRefusal({
      press: 'step',
      number: 591,
      title: 'Draw it',
      liveness: 'quiet',
      run: quietRun,
      now: NOW,
    });
    expect(said).not.toContain('?');
  });
});
