import { describe, expect, it } from 'vitest';
import { freshSteps, type PreparationRow, type PreparationStepRow } from './run';
import type { PreparationStepKey } from './steps';
import { BRANCH_STEPS } from './branch';
import { branchPreparationView, countsLine, preparationView, tookLine, unitsComeAtStep } from './view';

function run(patch: Partial<PreparationRow> = {}): PreparationRow {
  return {
    id: 'r',
    userId: 'u',
    subjectId: 's',
    status: 'running',
    currentStep: null,
    startedAt: '2026-10-16T09:00:00Z',
    finishedAt: null,
    error: null,
    failures: 0,
    ...patch,
  };
}

function steps(patch: Partial<Record<PreparationStepKey, Partial<PreparationStepRow>>>): PreparationStepRow[] {
  return freshSteps().map((s) => ({ ...s, ...patch[s.key] }));
}

describe('preparationView', () => {
  it('reads a subject with no run as one to offer preparing', () => {
    expect(preparationView(null)).toEqual({ kind: 'none' });
  });

  it('marks the first step on a run that has not begun', () => {
    const view = preparationView({ run: run({ status: 'pending', startedAt: null }), steps: freshSteps() });
    expect(view.kind).toBe('working');
    if (view.kind !== 'working') return;
    expect(view.starting).toBe(true);
    expect(view.position).toBe(1);
    expect(view.total).toBe(7);
    expect(view.lines.map((l) => l.state)).toEqual(['current', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(view.lines[0].detail).toBe('Starting in a moment.');
  });

  it('shows what done steps found, the running one, and skipped reasons', () => {
    const view = preparationView({
      run: run({ currentStep: 'compile_territory' }),
      steps: steps({
        classify: { status: 'done', summary: 'A practitioner subject.' },
        pull_documents: { status: 'done', counts: { documents: 4 } },
        match_weeks: { status: 'skipped', summary: 'Skipped: later.' },
        compile_territory: { status: 'running' },
      }),
    });
    if (view.kind !== 'working') throw new Error(view.kind);
    expect(view.position).toBe(4);
    expect(view.lines.slice(0, 5).map((l) => [l.state, l.detail])).toEqual([
      ['done', 'A practitioner subject.'],
      ['done', '4 documents stored'],
      ['skipped', 'Skipped: later.'],
      ['current', 'Working on it.'],
      ['pending', null],
    ]);
  });

  it('puts the reason on the failed step', () => {
    const view = preparationView({
      run: run({ status: 'failed', currentStep: 'draft_topics', error: 'Draft: boom' }),
      steps: steps({ classify: { status: 'done' }, draft_topics: { status: 'failed', error: 'boom' } }),
    });
    if (view.kind !== 'failed') throw new Error(view.kind);
    expect(view.position).toBe(5);
    expect(view.lines[4]).toMatchObject({ state: 'failed', detail: 'boom' });
  });

  it('falls back to the run error when no step row says failed', () => {
    const view = preparationView({
      run: run({ status: 'failed', currentStep: 'classify', error: 'Work out: gone' }),
      steps: freshSteps(),
    });
    if (view.kind !== 'failed') throw new Error(view.kind);
    expect(view.lines[0]).toMatchObject({ state: 'failed', detail: 'Work out: gone' });
  });

  it('folds a finished run to one line with the time and what it found', () => {
    const view = preparationView({
      run: run({ status: 'done', finishedAt: '2026-10-16T09:07:00Z' }),
      steps: steps({
        pull_documents: { status: 'done', counts: { documents: 4 } },
        draft_topics: { status: 'done', counts: { topics: 31 } },
        finish: { status: 'done', counts: { seconds: 420 } },
      }),
    });
    expect(view).toEqual({ kind: 'finished', summary: 'Prepared in 7 minutes · 4 documents stored, 31 topics drafted' });
  });
});

describe('countsLine and tookLine', () => {
  it('words known counts, names unknown ones and hides bookkeeping', () => {
    expect(countsLine({ documents: 1, new_things: 2, seconds: 9 })).toBe('1 document stored, 2 new things');
    expect(countsLine({ seconds: 9 })).toBeNull();
  });

  it('says how long, in minutes and hours', () => {
    expect(tookLine('2026-10-16T09:00:00Z', '2026-10-16T09:00:20Z')).toBe('1 minute');
    expect(tookLine('2026-10-16T09:00:00Z', '2026-10-16T10:05:00Z')).toBe('1 hour 5 minutes');
    expect(tookLine(null, '2026-10-16T10:05:00Z')).toBeNull();
  });
});

describe('branchPreparationView (plan #2276.7)', () => {
  const branch = { key: 'unit-economics', frame: 'Unit economics', name: 'Unit economics', asks: [] };
  const five = (patch: Partial<Record<PreparationStepKey, Partial<PreparationStepRow>>>) =>
    steps(patch).filter((s) => BRANCH_STEPS.includes(s.key));

  it('draws a branch run as its five steps', () => {
    const view = branchPreparationView({
      run: run({ branch, currentStep: 'match_weeks' }),
      steps: five({ pull_documents: { status: 'done' } }),
    });
    expect(view?.name).toBe('Unit economics');
    expect(view?.view.kind === 'working' && [view.view.position, view.view.total]).toEqual([2, 5]);
  });

  it('folds a finished branch run to a line that names the branch', () => {
    const view = branchPreparationView({
      run: run({ branch, status: 'done', finishedAt: '2026-10-16T09:07:00Z' }),
      steps: five({ draft_topics: { status: 'done', counts: { drafted: 11 } } }),
    });
    expect(view?.view).toEqual({ kind: 'finished', summary: 'Went deeper on Unit economics: 11 topics drafted in 7 minutes.' });
  });

  it('is nothing for the subject’s own run', () => {
    expect(branchPreparationView({ run: run(), steps: steps({}) })).toBeNull();
  });
});

describe('unitsComeAtStep', () => {
  it('names the write_units step while the run is working towards it', () => {
    const view = preparationView({ run: run({ status: 'pending', startedAt: null }), steps: freshSteps() });
    expect(unitsComeAtStep(view)).toEqual({ position: 6, total: 7 });
  });

  it('says nothing once that step has gone, or when the run failed or has none', () => {
    const gone = preparationView({
      run: run({ currentStep: 'finish' }),
      steps: steps({ write_units: { status: 'skipped' }, finish: { status: 'running' } }),
    });
    expect(unitsComeAtStep(gone)).toBeNull();
    const failed = preparationView({
      run: run({ status: 'failed', currentStep: 'draft_topics', error: 'timed out' }),
      steps: steps({ draft_topics: { status: 'failed' } }),
    });
    expect(unitsComeAtStep(failed)).toBeNull();
    expect(unitsComeAtStep(preparationView(null))).toBeNull();
  });
});
