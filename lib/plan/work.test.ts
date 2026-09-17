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
  nothingToShowLine,
  pushLine,
  raisesFiledSince,
  runStartedLine,
  runWork,
  sourceNumbers,
  stepsClosedSince,
  workIsEmpty,
  type RunRaise,
  type StepClosure,
} from './work';

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
