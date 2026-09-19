/**
 * What a run has to show for itself, as rules.
 *
 * The three things a session leaves behind are a push, a closed step and a
 * raise, and each of them can be attributed to the wrong run: a step that
 * closed before the run was fired, a raise filed by an earlier run against the
 * same step, a reading nobody has taken at all. This pins each of those, and
 * pins the difference between "asked and it had pushed nothing" and "nobody
 * asked" -- the distinction #568 made `github_checked_at` the test of, and the
 * one a sentence on the page has to keep.
 */
import { describe, expect, it } from 'vitest';
import type { LastRun } from './run-end';
import {
  keyRefusal,
  nothingToShowLine,
  pushLine,
  raisesFiledSince,
  refusalLine,
  runStartedLine,
  runWork,
  sourceNumbers,
  stepsClosedSince,
  workIsEmpty,
  type RunRaise,
  type StepClosure,
} from './work';
import { READING_TRUSTED_FOR_MINUTES } from './liveness';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const FIRED = minutesAgo(40);

function run(over: Partial<LastRun> = {}): LastRun {
  return {
    status: 'started',
    createdAt: FIRED,
    error: null,
    job: 'step',
    reading: null,
    ...over,
  };
}

function step(over: Partial<StepClosure> & { number: number }): StepClosure {
  return {
    title: `Step ${over.number}`,
    status: 'done',
    completedAt: null,
    ...over,
  };
}

function raise(over: Partial<RunRaise> & { id: string }): RunRaise {
  return {
    title: 'Which key reads GitHub?',
    source: 'plan #501',
    createdAt: minutesAgo(10),
    ...over,
  };
}

describe('the steps a run closed', () => {
  it('takes the ones that closed after it was fired, oldest first', () => {
    const closed = stepsClosedSince(
      [
        step({ number: 2, completedAt: minutesAgo(5) }),
        step({ number: 1, completedAt: minutesAgo(20) }),
      ],
      FIRED,
    );
    expect(closed.map((one) => one.number)).toEqual([1, 2]);
  });

  it('leaves out a step that closed before the run started', () => {
    const closed = stepsClosedSince(
      [step({ number: 9, completedAt: minutesAgo(400) })],
      FIRED,
    );
    expect(closed).toEqual([]);
  });

  it('leaves out a step that is still open', () => {
    expect(stepsClosedSince([step({ number: 1 })], FIRED)).toEqual([]);
  });
});

describe('the raises a run filed', () => {
  it('reads the step numbers out of the source a session wrote', () => {
    expect(sourceNumbers('plan #501')).toEqual([501]);
    expect(sourceNumbers('plan #494 re-shape')).toEqual([494]);
    expect(sourceNumbers('notes session 2026-09-11')).toEqual([]);
    expect(sourceNumbers(null)).toEqual([]);
  });

  it('takes the ones that name one of its steps and were filed after it started', () => {
    const filed = raisesFiledSince(
      [
        raise({ id: 'mine', source: 'plan #501' }),
        raise({ id: 'earlier', source: 'plan #501', createdAt: minutesAgo(300) }),
        raise({ id: 'elsewhere', source: 'plan #12' }),
        raise({ id: 'nowhere', source: null }),
      ],
      [501, 502],
      FIRED,
    );
    expect(filed.map((one) => one.id)).toEqual(['mine']);
  });

  it('is empty when the run has no steps to be raised against', () => {
    expect(raisesFiledSince([raise({ id: 'a' })], [], FIRED)).toEqual([]);
  });
});

describe('what a run has to show', () => {
  it('gathers the push, the closures and the raises against one run', () => {
    const work = runWork({
      run: run({
        job: 'feature',
        reading: {
          checkedAt: minutesAgo(1),
          lastPush: { at: minutesAgo(6), sha: 'f04d9da1111', subject: 'Read a claim (plan #500)' },
          refusal: null,
        },
      }),
      steps: [
        step({ number: 494 }),
        step({ number: 500, completedAt: minutesAgo(8) }),
      ],
      raises: [raise({ id: 'r', source: 'plan #500' })],
    });

    expect(work.checked).toBe(true);
    expect(work.closed.map((one) => one.number)).toEqual([500]);
    expect(work.raises.map((one) => one.id)).toEqual(['r']);
    expect(workIsEmpty(work)).toBe(false);
    expect(pushLine(work.push!, NOW)).toBe('Last pushed 6m ago: Read a claim (plan #500)');
  });

  it('falls back to the sha when nothing recorded the commit subject', () => {
    // Which is every reading until the route that writes them looks a commit
    // up: the activity listing GitHub answers with carries no message.
    const line = pushLine({ at: minutesAgo(6), sha: 'f04d9da1111', subject: null }, NOW);
    expect(line).toBe('Last pushed 6m ago, f04d9da');
  });

  it('says nobody has asked GitHub, rather than that the run pushed nothing', () => {
    const work = runWork({ run: run(), steps: [step({ number: 1 })], raises: [] });
    expect(workIsEmpty(work)).toBe(true);
    expect(nothingToShowLine(work, NOW)).toBe(
      'Nothing closed or raised in the 40m since it started, and nothing has asked GitHub what it has pushed.',
    );
  });

  it('says the run pushed nothing once GitHub has actually been asked', () => {
    const work = runWork({
      run: run({ reading: { checkedAt: minutesAgo(1), lastPush: null, refusal: null } }),
      steps: [],
      raises: [],
    });
    expect(nothingToShowLine(work, NOW)).toBe('Nothing pushed, closed or raised in the 40m since it started.');
  });

  it('says GitHub refused rather than counting the silence as evidence', () => {
    const work = runWork({
      run: run({
        reading: { checkedAt: minutesAgo(1), lastPush: null, refusal: '401 Bad credentials' },
      }),
      steps: [],
      raises: [],
    });
    expect(nothingToShowLine(work, NOW)).toContain('GitHub would not say what it has pushed');
  });
});

describe('the line that names the run', () => {
  it('says which press started it, when, and how long it has been going', () => {
    expect(runStartedLine(runWork({ run: run(), steps: [], raises: [] }), NOW)).toBe(
      `A step run started ${FIRED.replace('T', ' ').slice(0, 16)}, going 40m.`,
    );
  });

  it('names a feature batch and a re-shape as themselves', () => {
    expect(runStartedLine(runWork({ run: run({ job: 'feature' }), steps: [], raises: [] }), NOW)).toContain(
      'A feature batch',
    );
    expect(runStartedLine(runWork({ run: run({ job: 'reshape' }), steps: [], raises: [] }), NOW)).toContain(
      'A re-shape',
    );
  });

  it('says a run that is over is over rather than still counting', () => {
    const stopped = runWork({ run: run({ status: 'failed' }), steps: [], raises: [] });
    expect(runStartedLine(stopped, NOW)).toContain('and stopped.');
    const done = runWork({ run: run({ status: 'finished' }), steps: [], raises: [] });
    expect(runStartedLine(done, NOW)).toContain('and finished.');
  });

  it('counts nothing at the clock’s pre-mount value, so both renders agree', () => {
    const work = runWork({ run: run(), steps: [], raises: [] });
    expect(runStartedLine(work, 0)).not.toContain('going');
    expect(nothingToShowLine(work, 0)).toContain('since it started');
  });
});

/**
 * The refusal, which is what #566 is for.
 *
 * Two lines, and they are not the same line. On the run it is why one of the
 * four things the block reports is missing, and it has to survive a run that
 * did push or close something -- the case that reached the page through
 * nothing at all before. Above the plan it is the state of the key, which is
 * one setting and not a fact about any single run.
 */
const REJECTED =
  'GITHUB_READ_TOKEN was rejected by GitHub (401) — it has expired or is mistyped. ' +
  'Set a new one in Vercel and redeploy.';

function refused(checked: number, refusal = REJECTED): LastRun {
  return run({ reading: { checkedAt: minutesAgo(checked), lastPush: null, refusal } });
}

describe('the line that says GitHub refused', () => {
  it('prints the reason as it was stored, since it is already a sentence', () => {
    const work = runWork({ run: refused(1), steps: [], raises: [] });
    expect(refusalLine(work)).toBe(REJECTED);
  });

  it('says nothing when GitHub answered', () => {
    const work = runWork({
      run: run({ reading: { checkedAt: minutesAgo(1), lastPush: null, refusal: null } }),
      steps: [],
      raises: [],
    });
    expect(refusalLine(work)).toBeNull();
    expect(refusalLine(runWork({ run: run(), steps: [], raises: [] }))).toBeNull();
  });

  it('survives a run that closed a step, which is what it could not do before', () => {
    // The refusal used to reach the page only through `nothingToShowLine`, and
    // a run with a closure to report is not empty -- so the rejected key was
    // invisible on exactly the runs that were getting work done.
    const work = runWork({
      run: refused(1),
      steps: [step({ number: 7, completedAt: minutesAgo(5) })],
      raises: [],
    });
    expect(workIsEmpty(work)).toBe(false);
    expect(refusalLine(work)).toBe(REJECTED);
  });
});

describe('the reason the key cannot be read, across the runs on the page', () => {
  it('is nothing when no run carries a refusal', () => {
    expect(keyRefusal([run(), run({ reading: null })], NOW)).toBeNull();
  });

  it('is the reason, once any run has one', () => {
    expect(keyRefusal([run(), refused(2)], NOW)).toBe(REJECTED);
  });

  it('is the newest of them, so a fixed key is not reported from an old row', () => {
    const older = refused(60, 'No GITHUB_READ_TOKEN is set, so pushes cannot be read.');
    expect(keyRefusal([older, refused(2)], NOW)).toBe(REJECTED);
    expect(keyRefusal([refused(2), older], NOW)).toBe(REJECTED);
  });

  it('is nothing from a refusal older than the trusted mark -- #570', () => {
    // Nothing has asked GitHub since, so the key may already have been
    // replaced. Telling somebody to set a token that works is worse than
    // saying nothing; the run row keeps the sentence either way.
    expect(keyRefusal([refused(READING_TRUSTED_FOR_MINUTES)], NOW)).toBeNull();
    expect(keyRefusal([refused(READING_TRUSTED_FOR_MINUTES - 1)], NOW)).toBe(REJECTED);
  });

  it('is nothing when there is nothing to read', () => {
    expect(keyRefusal([], NOW)).toBeNull();
  });
});
