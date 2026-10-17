import { describe, expect, it } from 'vitest';
import { FIRST_LESSON_LAYOUT_MS, firstLessonStep, type FirstLessonPorts, type FirstPiece } from './first-lesson-step';
import { freshSteps, type StepContext } from './run';

const NOW = Date.parse('2026-10-17T09:00:00Z');

function context(over: { budgetMs?: number; branch?: boolean } = {}): StepContext {
  const steps = freshSteps();
  return {
    subject: {
      id: 'sub',
      userId: 'me',
      name: 'Urban Economics',
      note: null,
      kind: 'academic_course',
      branch: over.branch ? { key: 'k', frame: 'F', name: 'F', asks: [] } : null,
    },
    run: {
      id: 'run',
      userId: 'me',
      subjectId: 'sub',
      status: 'running',
      currentStep: 'first_lesson',
      startedAt: null,
      finishedAt: null,
      error: null,
      failures: 0,
    },
    step: steps.find((s) => s.key === 'first_lesson')!,
    steps: new Map(steps.map((s) => [s.key, s])),
    deadline: NOW + (over.budgetMs ?? 200_000),
    now: () => NOW,
  };
}

function fake(state: { laidOut?: boolean; pieces?: FirstPiece[]; lessons?: string[]; units?: boolean } = {}) {
  const calls: string[] = [];
  let laidOut = state.laidOut ?? false;
  let pieces = state.pieces ?? [];
  const lessons = new Set(state.lessons ?? []);
  const ports: FirstLessonPorts = {
    firstUnit: async () => (state.units === false ? null : { id: 'u1', title: 'Why cities exist', laidOut }),
    layOut: async () => {
      calls.push('layOut');
      laidOut = true;
      return { outcome: 'laid-out', unitId: 'u1', goalId: 'g1', conceptIds: ['c1', 'c2', 'c3'] };
    },
    pieces: async () => pieces,
    writePieces: async () => {
      calls.push('writePieces');
      pieces = [
        { id: 'p1', title: 'Agglomeration', conceptIds: ['c1', 'c2'] },
        { id: 'p2', title: 'Land rent', conceptIds: ['c3'] },
      ];
      return { outcome: 'written', pieces: 2 };
    },
    lessons: async (ids) => new Set(ids.filter((id) => lessons.has(id))),
    writeLesson: async (_s, unitId, conceptId) => {
      calls.push(`lesson ${unitId} ${conceptId}`);
      lessons.add(conceptId);
      return { outcome: 'ready' };
    },
  };
  return { ports, calls };
}

describe('the first_lesson step', () => {
  it('lays out the first unit, splits it and writes the first piece’s lessons', async () => {
    const { ports, calls } = fake();
    const outcome = await firstLessonStep(ports)(context());
    expect(calls).toEqual(['layOut', 'writePieces', 'lesson u1 c1', 'lesson u1 c2']);
    expect(outcome).toMatchObject({
      state: 'done',
      counts: { pieces: 2, lessons: 2 },
      detail: { unitId: 'u1', pieceId: 'p1' },
    });
    expect(outcome.state === 'done' && outcome.summary).toBe(
      'Laid out Why cities exist in 2 pieces, with 2 lessons written for Agglomeration.',
    );
  });

  it('carries on from what an earlier call wrote', async () => {
    const { ports, calls } = fake({
      laidOut: true,
      pieces: [{ id: 'p1', title: 'Agglomeration', conceptIds: ['c1', 'c2'] }],
      lessons: ['c1'],
    });
    const outcome = await firstLessonStep(ports)(context());
    expect(calls).toEqual(['lesson u1 c2']);
    expect(outcome).toMatchObject({ state: 'done', counts: { pieces: 1, lessons: 2 } });
  });

  it('pauses before the layout when the chain call would not fit', async () => {
    const { ports, calls } = fake();
    const outcome = await firstLessonStep(ports)(context({ budgetMs: FIRST_LESSON_LAYOUT_MS - 1 }));
    expect(calls).toEqual([]);
    expect(outcome).toMatchObject({ state: 'more', pause: true });
  });

  it('fails the run when the layout fails', async () => {
    const { ports } = fake();
    ports.layOut = async () => ({ outcome: 'failed', detail: 'model refused' });
    await expect(firstLessonStep(ports)(context())).rejects.toThrow('Laying out Why cities exist failed: model refused');
  });

  it('keeps going past a lesson that fails and says so', async () => {
    const { ports } = fake({ laidOut: true, pieces: [{ id: 'p1', title: 'Agglomeration', conceptIds: ['c1', 'c2'] }] });
    ports.writeLesson = async (_s, _u, conceptId) =>
      conceptId === 'c1' ? { outcome: 'failed', detail: 'timeout' } : { outcome: 'ready' };
    const outcome = await firstLessonStep(ports)(context());
    expect(outcome).toMatchObject({ state: 'done', counts: { lessons: 1 } });
    expect(outcome.state === 'done' && outcome.summary).toContain('1 lesson failed and will be written when the piece is opened: timeout');
  });

  it('skips a branch run and a subject with no units', async () => {
    expect(await firstLessonStep(fake().ports)(context({ branch: true }))).toMatchObject({ state: 'skipped' });
    expect(await firstLessonStep(fake({ units: false }).ports)(context())).toMatchObject({ state: 'skipped' });
  });
});
