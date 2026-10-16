import { describe, expect, it, vi } from 'vitest';
import type { Territory, TerritoryTopic } from '@/lib/learn/levels/territory';
import { curriculumPrompt } from '@/lib/learn/graph/curriculum';
import type { StepContext, PreparationStepRow } from './run';
import {
  DRAFT_LANES,
  DRAFT_START_MS,
  DRAFT_TRIES,
  draftTopicsStep,
  lanesOf,
  openingTerritory,
  topicsNamed,
  writeUnitsStep,
  type DraftTopicsPorts,
  type LaneResult,
  type SubjectUnit,
  type WriteUnitsPorts,
} from './draft-steps';

vi.mock('server-only', () => ({}));

function ctx(over: { detail?: Record<string, unknown>; now?: number; deadline?: number } = {}): StepContext {
  const step: PreparationStepRow = {
    key: 'draft_topics',
    ordinal: 5,
    status: 'running',
    startedAt: null,
    finishedAt: null,
    summary: null,
    counts: {},
    detail: over.detail ?? {},
    calls: 0,
    error: null,
  };
  return {
    subject: { id: 's1', userId: 'u1', name: 'Beekeeping', note: 'Keep two hives', kind: null },
    run: { id: 'r1', userId: 'u1', subjectId: 's1', status: 'running', currentStep: 'draft_topics', startedAt: null, finishedAt: null, error: null, failures: 0 },
    step,
    steps: new Map(),
    deadline: over.deadline ?? 240_000,
    now: () => over.now ?? 0,
  };
}

const topic = (n: number): TerritoryTopic => ({ ask: `Topic ${n}`, scope: `Scope ${n}.`, frame: 'Beekeeping', target: 4, from: [] });

function territory(count: number): Territory {
  return {
    key: 'subject-s1',
    name: 'Beekeeping',
    subjectLens: 'Beekeeping',
    performances: ['Inspect a hive'],
    roles: [],
    texts: [{ key: 'd1', label: 'Bee course', items: ['Week 1: the colony', 'Week 2: the hive', 'Week 3: swarms'] }],
    topics: Array.from({ length: count }, (_, i) => topic(i + 1)),
    kind: null,
  };
}

/** Ports over an in-memory topic list: each lane drafts every topic it is handed. */
function draftPorts(t: Territory, over: Partial<DraftTopicsPorts> = {}) {
  const asked: string[] = [];
  const draft = vi.fn(async (lane: Territory): Promise<LaneResult> => {
    const drafted = lane.topics.map((x) => ({ ask: x.ask, id: `id-${x.ask}`, name: x.ask }));
    asked.push(...drafted.map((d) => d.ask));
    return { drafted, failed: [] };
  });
  const ports: DraftTopicsPorts = {
    territory: async () => t,
    lens: vi.fn(async () => ({ id: 'lens1', name: 'Beekeeping (renamed)' })),
    asked: async () => [...asked],
    draft,
    targets: vi.fn(async (_lens: string, topics: readonly TerritoryTopic[]) => topics.length),
    ...over,
  };
  return { ports, draft, asked };
}

describe('lanesOf', () => {
  it('splits topics round-robin, at most perLane each', () => {
    expect(lanesOf([1, 2, 3, 4, 5], 2, 2)).toEqual([[1, 3], [2, 4]]);
    expect(lanesOf([1], 4, 3)).toEqual([[1]]);
    expect(lanesOf([], 4, 3)).toEqual([]);
  });
});

describe('draftTopicsStep', () => {
  it('drafts lanes side by side and records drafted and remaining counts', async () => {
    const { ports, draft } = draftPorts(territory(20));
    const out = await draftTopicsStep(ports)(ctx());
    expect(draft).toHaveBeenCalledTimes(DRAFT_LANES);
    // Each lane drafts under the lens's current name, with no kind so it never pulls.
    expect(draft.mock.calls[0][0]).toMatchObject({ subjectLens: 'Beekeeping (renamed)', kind: null });
    expect(out).toMatchObject({ state: 'more', summary: '12 of 20 topics drafted.', counts: { topics: 20, drafted: 12, remaining: 8 } });
    expect(out.state !== 'skipped' && out.detail).toMatchObject({ lens: { id: 'lens1' } });
  });

  it('pauses for a fresh call when too little time is left to start a draft', async () => {
    const { ports, draft } = draftPorts(territory(5));
    const out = await draftTopicsStep(ports)(ctx({ now: 240_000 - DRAFT_START_MS + 1 }));
    expect(draft).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'more', pause: true, counts: { drafted: 0, remaining: 5 } });
  });

  it('resumes from the lens it recorded and finishes with targets when none remain', async () => {
    const t = territory(3);
    const { ports, asked } = draftPorts(t);
    asked.push('Topic 1', 'topic 2 ', 'Topic 3');
    const out = await draftTopicsStep(ports)(ctx({ detail: { lens: { id: 'lens1', name: 'Beekeeping' } } }));
    expect(ports.lens).not.toHaveBeenCalled();
    expect(ports.targets).toHaveBeenCalledWith('lens1', t.topics);
    expect(out).toMatchObject({ state: 'done', counts: { drafted: 3, remaining: 0, targeted: 3 } });
  });

  it('gives up on a topic the drafter turns down twice, so the run can finish', async () => {
    const t = territory(2);
    let detail: Record<string, unknown> = {};
    const { ports, asked } = draftPorts(t, {
      draft: async (lane) => {
        const drafted = lane.topics.filter((x) => x.ask !== 'Topic 2').map((x) => ({ ask: x.ask, id: x.ask, name: x.ask }));
        asked.push(...drafted.map((d) => d.ask));
        return { drafted, failed: lane.topics.filter((x) => x.ask === 'Topic 2').map((x) => ({ ask: x.ask, detail: 'too vague' })) };
      },
    });
    const step = draftTopicsStep(ports);
    for (let i = 0; i < DRAFT_TRIES; i++) {
      const out = await step(ctx({ detail }));
      expect(out.state).toBe('more');
      detail = (out as { detail: Record<string, unknown> }).detail;
    }
    const out = await step(ctx({ detail }));
    expect(out).toMatchObject({ state: 'done', counts: { drafted: 1, failed: 1, remaining: 0 } });
    expect(out.state === 'done' && out.summary).toContain('1 topic could not be drafted');
  });

  it('keeps what the other lanes drafted when one lane throws', async () => {
    let call = 0;
    const { ports, asked } = draftPorts(territory(8), {
      draft: async (lane) => {
        if (call++ === 0) throw new Error('database blip');
        asked.push(...lane.topics.map((x) => x.ask));
        return { drafted: lane.topics.map((x) => ({ ask: x.ask, id: x.ask, name: x.ask })), failed: [] };
      },
    });
    const out = await draftTopicsStep(ports)(ctx());
    expect(out).toMatchObject({ state: 'more', counts: { drafted: 6, remaining: 2 } });
  });

  it('fails the step when every lane throws', async () => {
    const { ports } = draftPorts(territory(4), { draft: async () => Promise.reject(new Error('no key')) });
    await expect(draftTopicsStep(ports)(ctx())).rejects.toThrow('no key');
  });

  it('is skipped when no territory was stored', async () => {
    const { ports } = draftPorts(territory(1), { territory: async () => null });
    expect(await draftTopicsStep(ports)(ctx())).toMatchObject({ state: 'skipped' });
  });
});

const unit = (id: string, ordinal: number, over: Partial<SubjectUnit> = {}): SubjectUnit => ({
  id,
  ordinal,
  title: `Unit ${id}`,
  placeholder: true,
  passed: false,
  ...over,
});

function unitPorts(units: SubjectUnit[], over: Partial<WriteUnitsPorts> = {}) {
  const ports: WriteUnitsPorts = {
    territory: async () => territory(15),
    names: async () => new Map([['topic 1', 'The colony'], ['topic 2', 'Hive anatomy']]),
    units: async () => units,
    write: vi.fn(async () => ({
      ok: true as const,
      goalUnit: null,
      units: [
        { title: 'Colonies and hives', covers: 'Teaches The colony and Hive anatomy.', outcome: 'Name the parts of a hive.' },
        { title: 'Swarms', covers: 'Teaches Topic 3.', outcome: 'Spot a swarm coming.' },
        { title: 'Unit typed', covers: 'Repeats a kept unit.', outcome: 'x' },
      ],
    })),
    replace: vi.fn(async () => {}),
    ...over,
  };
  return ports;
}

describe('writeUnitsStep', () => {
  it('replaces the placeholders and keeps typed and passed units after the new ones', async () => {
    const ports = unitPorts([
      unit('a', 1),
      unit('typed', 2, { placeholder: false }),
      unit('b', 3, { passed: true }),
      unit('c', 4),
    ]);
    const out = await writeUnitsStep(ports)(ctx());
    expect(ports.write).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Beekeeping',
        asked: 'Keep two hives',
        territory: expect.objectContaining({ after: ['Unit typed', 'Unit b'] }),
      }),
    );
    expect(ports.replace).toHaveBeenCalledWith('s1', {
      remove: ['a', 'c'],
      units: [expect.objectContaining({ title: 'Colonies and hives' }), expect.objectContaining({ title: 'Swarms' })],
      kept: ['typed', 'b'],
    });
    expect(out).toMatchObject({ state: 'done', counts: { units: 2, replaced: 2, kept: 2, topicsNamed: 3 } });
  });

  it('writes units for a subject that has none', async () => {
    const ports = unitPorts([]);
    const out = await writeUnitsStep(ports)(ctx());
    expect(ports.replace).toHaveBeenCalledWith('s1', expect.objectContaining({ remove: [], kept: [] }));
    expect(out.state).toBe('done');
  });

  it('leaves a curriculum with no placeholder alone', async () => {
    const ports = unitPorts([unit('typed', 1, { placeholder: false }), unit('a', 2, { passed: true })]);
    const out = await writeUnitsStep(ports)(ctx());
    expect(ports.write).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'skipped' });
  });

  it('pauses rather than starting the call with too little time left', async () => {
    const ports = unitPorts([unit('a', 1)]);
    const out = await writeUnitsStep(ports)(ctx({ now: 200_000 }));
    expect(ports.write).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: 'more', pause: true });
  });

  it('fails without touching the units when the call fails', async () => {
    const ports = unitPorts([unit('a', 1)], { write: async () => ({ ok: false, detail: 'overloaded' }) });
    await expect(writeUnitsStep(ports)(ctx())).rejects.toThrow('overloaded');
    expect(ports.replace).not.toHaveBeenCalled();
  });
});

describe('the units prompt', () => {
  it('gives the opening topics as drafted, how the documents open, and the units kept', () => {
    const opening = openingTerritory(territory(20), new Map([['topic 1', 'The colony']]), ['My own unit']);
    expect(opening.topics).toHaveLength(12);
    expect(opening.topics[0]).toEqual({ name: 'The colony', scope: 'Scope 1.' });
    expect(opening.topics[1].name).toBe('Topic 2');
    const prompt = curriculumPrompt({ subject: 'Beekeeping', asked: null, territory: opening });
    expect(prompt).toContain('1. The colony: Scope 1.');
    expect(prompt).toContain('- Week 1: the colony');
    expect(prompt).toContain('- My own unit');
    expect(prompt).toContain('name the topics the unit teaches');
  });

  it('is unchanged for a subject with no territory', () => {
    const prompt = curriculumPrompt({ subject: 'Beekeeping', asked: 'two hives' });
    expect(prompt).not.toContain('laid out');
    expect(prompt).toContain('What they asked for when they started it: two hives');
  });

  it('counts the topics the units name', () => {
    expect(topicsNamed([{ title: 'A', covers: 'The colony and swarms', outcome: '' }], [{ name: 'The colony' }, { name: 'Varroa' }])).toBe(1);
  });
});
