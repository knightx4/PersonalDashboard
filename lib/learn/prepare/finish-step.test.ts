import { describe, expect, it } from 'vitest';
import type { Territory } from '@/lib/learn/levels/territory';
import { finishPreparationStep, framesOf, sourceDocuments, type FinishDetail, type FinishPorts } from './finish-step';
import { freshSteps, type PreparationStepRow, type StepContext } from './run';
import type { PreparationStepKey } from './steps';
import type { PulledDocument } from './structure-steps';
import { preparationSources } from './view';

const PULLED: PulledDocument[] = [
  { itemId: 'i1', title: 'Bee course syllabus', provider: 'Open Syllabus', url: 'https://a.edu/bees', licence: 'structure_only', units: 12 },
  { itemId: 'i2', title: 'Hive health', provider: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Hive', licence: 'show', units: 4 },
];

const TERRITORY: Territory = {
  key: 'subject-s1',
  name: 'Beekeeping',
  subjectLens: 'Beekeeping',
  performances: [],
  roles: [],
  texts: [
    { key: 'd1', label: 'Bee course syllabus', items: ['Week 1'], itemId: 'i1', url: 'https://a.edu/bees' },
    { key: 'd2', label: 'Apiculture reading list', items: ['Week 1'], itemId: 'i9', url: 'https://b.edu/api' },
  ],
  topics: [
    { ask: 'The colony', scope: '', frame: 'Insects', target: 3, from: [] },
    { ask: 'Swarming', scope: '', frame: 'Insects', target: 3, from: [] },
    { ask: 'Hive inspection', scope: '', frame: 'Animal husbandry', target: 3, from: [] },
  ],
};

function ctx(pullDetail: Record<string, unknown> | undefined): StepContext {
  const rows = new Map<PreparationStepKey, PreparationStepRow>(
    freshSteps().map((s) => [s.key, s.key === 'pull_documents' ? { ...s, status: 'done', detail: pullDetail } : s]),
  );
  return {
    subject: { id: 's1', userId: 'u1', name: 'Beekeeping', note: null, kind: null },
    run: { id: 'r1', userId: 'u1', subjectId: 's1', status: 'running', currentStep: 'finish', startedAt: '2026-10-16T09:00:00Z', finishedAt: null, error: null, failures: 0 },
    step: rows.get('finish')!,
    steps: rows,
    deadline: Date.parse('2026-10-16T09:10:00Z'),
    now: () => Date.parse('2026-10-16T09:07:00Z'),
  };
}

function ports(over: Partial<FinishPorts> = {}): FinishPorts {
  return {
    territory: async () => TERRITORY,
    firstUnit: async () => 'What a colony is',
    // The first topic was given up on; the second was drafted.
    drafted: async () => new Map([['swarming', { id: 't2', name: 'Why colonies swarm' }]]),
    catalogue: async () =>
      new Map([
        ['i1', { provider: 'Open Syllabus', licence: 'structure_only', rights: 'Copyright of the instructor; structure only', units: 12 }],
        ['i9', { provider: 'University of B', licence: 'show', rights: 'CC BY 4.0', units: 8 }],
      ]),
    ...over,
  };
}

describe('sourceDocuments', () => {
  it('lists every pulled document, then each one the territory read from the bank', () => {
    const docs = sourceDocuments(PULLED, TERRITORY);
    expect(docs.map((d) => [d.title, d.used])).toEqual([
      ['Bee course syllabus', true],
      ['Hive health', false],
      ['Apiculture reading list', true],
    ]);
    expect(docs[2]).toMatchObject({ provider: null, licence: null, url: 'https://b.edu/api' });
  });

  it('keeps the pulled documents when there is no territory', () => {
    expect(sourceDocuments(PULLED, null).map((d) => d.used)).toEqual([false, false]);
  });
});

describe('finishPreparationStep drafts', () => {
  it('lists the topics still drafts with why, and says so in the summary', async () => {
    const c = ctx(undefined);
    const kept = [{ ask: 'Swarming', name: 'Why colonies swarm', reason: '1 row cites no source' }];
    const steps = new Map(c.steps);
    steps.set('draft_topics', { ...steps.get('draft_topics')!, status: 'done', detail: { kept } });
    const out = await finishPreparationStep(ports())({ ...c, steps });
    if (out.state !== 'done') throw new Error('not done');
    expect((out.detail as FinishDetail).drafts).toEqual(kept);
    expect(out.summary).toContain('Why colonies swarm (1 row cites no source)');
  });

  it('has no drafts line when every topic was approved', async () => {
    const out = await finishPreparationStep(ports())(ctx(undefined));
    if (out.state !== 'done') throw new Error('not done');
    expect((out.detail as FinishDetail).drafts).toEqual([]);
    expect(out.summary).not.toContain('still a draft');
  });
});

describe('framesOf', () => {
  it('names each frame once, in territory order', () => {
    expect(framesOf(TERRITORY)).toEqual(['Insects', 'Animal husbandry']);
  });
});

describe('finishPreparationStep', () => {
  it('records where to start and every source', async () => {
    const out = await finishPreparationStep(ports())(ctx({ documents: PULLED }));
    expect(out.state).toBe('done');
    if (out.state !== 'done') return;
    expect(out.summary).toBe('Prepared in 7 minutes. Start with What a colony is.');
    expect(out.counts).toEqual({ seconds: 420 });
    const detail = out.detail as FinishDetail;
    expect(detail.start).toEqual({ unit: 'What a colony is', topic: { id: 't2', name: 'Why colonies swarm', ask: 'Swarming' } });
    expect(detail.documents).toHaveLength(3);
    // The catalogue fills the licence of each, and the provider of the one the pull did not store.
    expect(detail.documents[0]).toMatchObject({ provider: 'Open Syllabus', rights: 'Copyright of the instructor; structure only' });
    expect(detail.documents[1].rights).toBeUndefined();
    expect(detail.documents[2]).toMatchObject({ provider: 'University of B', licence: 'show', rights: 'CC BY 4.0', units: 8 });
    expect(detail.frames).toEqual(['Insects', 'Animal husbandry']);
  });

  it('finishes with no territory, no units and nothing pulled', async () => {
    const out = await finishPreparationStep(
      ports({ territory: async () => null, firstUnit: async () => null }),
    )(ctx(undefined));
    expect(out).toMatchObject({
      state: 'done',
      summary: 'Prepared in 7 minutes.',
      detail: { start: { unit: null, topic: null }, documents: [], frames: [] },
    });
  });
});

describe('the finished line', () => {
  it('reads each count from its own step, not a sum over every step', () => {
    const run = { ...ctx(undefined).run, status: 'done' as const, finishedAt: '2026-10-16T09:07:00Z' };
    const counts: Partial<Record<PreparationStepKey, Record<string, number>>> = {
      pull_documents: { documents: 4, units: 40, searched: 3, failed: 0 },
      match_weeks: { weeks: 11, documents: 3 },
      compile_territory: { topics: 34, documents: 4, canonical: 10 },
      draft_topics: { topics: 34, drafted: 31, remaining: 0, failed: 3 },
      write_units: { units: 4, replaced: 4, kept: 0, topicsNamed: 6 },
      finish: { seconds: 420 },
    };
    const steps = freshSteps().map((s) => ({ ...s, status: 'done' as const, counts: counts[s.key] ?? {} }));
    expect(preparationSources({ run, steps })?.summary).toBe(
      'Prepared in 7 minutes · 4 documents stored, 11 weeks matched, 31 topics drafted, 4 units written',
    );
  });

  it('leaves out a zero', () => {
    const run = { ...ctx(undefined).run, status: 'done' as const, finishedAt: '2026-10-16T09:07:00Z' };
    const steps = freshSteps().map((s) => ({
      ...s,
      status: 'done' as const,
      counts: (s.key === 'pull_documents' ? { documents: 0 } : s.key === 'write_units' ? { units: 4 } : {}) as Record<string, number>,
    }));
    expect(preparationSources({ run, steps })?.summary).toBe('Prepared in 7 minutes · 4 units written');
  });
});

describe('preparationSources', () => {
  it('is null until the run is done', () => {
    expect(preparationSources(null)).toBeNull();
    const steps = freshSteps();
    expect(preparationSources({ run: { ...ctx(undefined).run, status: 'running' }, steps })).toBeNull();
  });

  it('reads the finish detail, and falls back to the pulled documents', async () => {
    const out = await finishPreparationStep(ports())(ctx({ documents: PULLED }));
    const detail = out.state === 'done' ? out.detail : undefined;
    const run = { ...ctx(undefined).run, status: 'done' as const, finishedAt: '2026-10-16T09:07:00Z' };
    const withFinish = freshSteps().map((s) =>
      s.key === 'finish' ? { ...s, status: 'done' as const, detail } : { ...s, status: 'done' as const },
    );
    const read = preparationSources({ run, steps: withFinish });
    expect(read?.start.topic?.name).toBe('Why colonies swarm');
    expect(read?.documents).toHaveLength(3);
    expect(read?.summary).toBe('Prepared in 7 minutes');

    const older = freshSteps().map((s) =>
      s.key === 'pull_documents' ? { ...s, status: 'done' as const, detail: { documents: PULLED } } : { ...s, status: 'done' as const },
    );
    const fallback = preparationSources({ run, steps: older });
    expect(fallback?.documents.map((d) => d.title)).toEqual(['Bee course syllabus', 'Hive health']);
    expect(fallback?.start).toEqual({ unit: null, topic: null });
  });
});
