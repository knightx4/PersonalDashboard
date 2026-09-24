import { describe, expect, it } from 'vitest';
import {
  captureContext,
  captureMessage,
  describeFiled,
  fileCapture,
  markUndone,
  MAX_FILED,
  parseFiling,
  readFiled,
  undoMove,
  type CaptureContext,
  type FiledEntry,
  type FilingDeps,
  type PlannedAction,
} from './capture';
import type { PeriodRow, RhythmRecord } from './rhythms';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

function goal(id: string, extra: Partial<Goal> = {}): { goal: Goal; areaName: string } {
  return {
    goal: {
      id,
      areaId: 'area',
      title: `Goal ${id}`,
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
      ...extra,
    },
    areaName: 'The city',
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: `Step ${id}`,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    ...extra,
  };
}

function period(itemId: string, extra: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id: `p-${itemId}`,
    itemId,
    startsOn: '2026-09-21',
    endsOn: '2026-09-28',
    target: 1,
    count: 0,
    kept: null,
    closedAt: null,
    ...extra,
  };
}

function contextOf(
  goals: ReturnType<typeof goal>[],
  steps: Step[],
  records: Map<string, RhythmRecord> = new Map(),
): CaptureContext {
  const { byGoal } = buildForest(
    goals.map((g) => g.goal.id),
    steps,
  );
  return captureContext(goals, byGoal, records);
}

/** The city goal from the spec: a rhythm, an open step, a closed one, a question. */
const city = contextOf(
  [goal('city'), goal('debt', { status: 'proposed' }), goal('friends')],
  [
    step('events', 'city', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week' }),
    step('talk', 'city'),
    step('closed', 'city', { status: 'done' }),
    step('under-closed', 'closed'),
    step('ask', 'city', { kind: 'decision' }),
    step('under-ask', 'ask', { kind: 'claude' }),
    step('mine', 'friends'),
  ],
  new Map([['events', { current: period('events'), past: [], missed: 0 }]]),
);

const ref = (id: string) => city.steps.find((s) => s.id === id)?.ref ?? city.goals.find((g) => g.id === id)?.ref;

describe('captureContext', () => {
  it('offers open goals and the open steps under them, and nothing else', () => {
    expect(city.goals.map((g) => g.id)).toEqual(['city', 'friends']);
    expect(city.steps.map((s) => s.id)).toEqual(['events', 'talk', 'under-ask', 'mine']);
  });

  it('gives each a short ref, so the model never copies an id', () => {
    expect(city.goals.map((g) => g.ref)).toEqual(['g1', 'g2']);
    expect(city.steps.map((s) => s.ref)).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('carries a rhythm’s open period, and none when it has no open one', () => {
    expect(city.steps[0]!.rhythm).toEqual({
      period: 'week',
      startsOn: '2026-09-21',
      count: 0,
      target: 1,
    });
    const without = contextOf(
      [goal('g')],
      [step('r', 'g', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week' })],
    );
    expect(without.steps[0]!.rhythm).toBeNull();
  });

  it('writes the goals, the steps and the sentence into one message', () => {
    const message = captureMessage(city, 'went to the Van Alen talk', '2026-09-24');
    expect(message).toContain('Today is 2026-09-24.');
    expect(message).toContain('g1: Goal city (area: The city)');
    expect(message).toContain('s1 [rhythm, 0 of 1 this week]: Step events');
    expect(message).toContain('s2 [mine]: Step talk');
    expect(message.endsWith('went to the Van Alen talk')).toBe(true);
  });
});

describe('parseFiling', () => {
  it('turns each move into an action against the row it names', () => {
    const planned = parseFiling(
      {
        actions: [
          { type: 'close', step: ref('talk') },
          { type: 'count', step: ref('events') },
          { type: 'note', goal: ref('friends'), text: ' met someone from a transit nonprofit ' },
          { type: 'add', parent: ref('city'), title: 'Find the volunteer sign-up', kind: 'claude' },
        ],
      },
      city,
    );
    expect(planned.map((p) => p.kind)).toEqual(['close', 'count', 'note', 'add']);
    expect((planned[0] as Extract<PlannedAction, { kind: 'close' }>).step.id).toBe('talk');
    expect((planned[2] as Extract<PlannedAction, { kind: 'note' }>).text).toBe(
      'met someone from a transit nonprofit',
    );
    const add = planned[3] as Extract<PlannedAction, { kind: 'add' }>;
    expect(add.goal.id).toBe('city');
    expect(add.parent).toBeNull();
    expect(add.stepKind).toBe('claude');
  });

  it('adds under a step, and finds the goal from it', () => {
    const [add] = parseFiling(
      { actions: [{ type: 'add', parent: ref('mine'), title: 'Text them back' }] },
      city,
    ) as Extract<PlannedAction, { kind: 'add' }>[];
    expect(add!.parent?.id).toBe('mine');
    expect(add!.goal.id).toBe('friends');
    expect(add!.stepKind).toBe('mine');
  });

  it('drops refs it was not shown and moves capture does not make', () => {
    const planned = parseFiling(
      {
        actions: [
          { type: 'close', step: 's99' },
          { type: 'close', step: ref('events') },
          { type: 'count', step: ref('talk') },
          { type: 'note', goal: ref('friends'), text: '   ' },
          { type: 'add', parent: ref('events'), title: 'Under a rhythm' },
          { type: 'add', parent: ref('city'), title: '' },
          { type: 'delete', step: ref('talk') },
          'close s2',
          null,
        ],
      },
      city,
    );
    expect(planned).toEqual([]);
  });

  it('refuses a count on a rhythm with no open period', () => {
    const without = contextOf(
      [goal('g')],
      [step('r', 'g', { kind: 'rhythm', rhythmCount: 1, rhythmPeriod: 'week' })],
    );
    expect(parseFiling({ actions: [{ type: 'count', step: 's1' }] }, without)).toEqual([]);
  });

  it('files a repeated move once, and no more than the cap', () => {
    const twice = parseFiling(
      {
        actions: [
          { type: 'close', step: ref('talk') },
          { type: 'close', step: ref('talk') },
          { type: 'add', parent: ref('city'), title: 'Call back' },
          { type: 'add', parent: ref('city'), title: 'call back' },
        ],
      },
      city,
    );
    expect(twice.map((p) => p.kind)).toEqual(['close', 'add']);

    const many = parseFiling(
      {
        actions: Array.from({ length: 20 }, (_, i) => ({
          type: 'add',
          parent: ref('city'),
          title: `Step ${i}`,
        })),
      },
      city,
    );
    expect(many).toHaveLength(MAX_FILED);
  });

  it('reads anything that is not a list of moves as nothing to do', () => {
    expect(parseFiling(null, city)).toEqual([]);
    expect(parseFiling({ actions: 'close s2' }, city)).toEqual([]);
    expect(parseFiling({}, city)).toEqual([]);
  });
});

/** Stubbed model and database, recording what was written. */
function stubs(input: unknown, overrides: Partial<FilingDeps> = {}) {
  const kept: string[] = [];
  const applied: PlannedAction[] = [];
  const saved: FiledEntry[][] = [];
  const asked: string[] = [];
  const deps: FilingDeps = {
    keep: async (body) => {
      kept.push(body);
      return 'capture-1';
    },
    context: async () => city,
    ask: async (message) => {
      asked.push(message);
      return { ok: true, input };
    },
    apply: async (_id, action) => {
      applied.push(action);
      switch (action.kind) {
        case 'close':
          return { kind: 'close', step_id: action.step.id, title: action.step.title, goal_title: action.step.goalTitle, undone_at: null };
        case 'count':
          return { kind: 'count', step_id: action.step.id, title: action.step.title, goal_title: action.step.goalTitle, starts_on: '2026-09-21', undone_at: null };
        case 'note':
          return { kind: 'note', goal_id: action.goal.id, goal_title: action.goal.title, text: action.text, undone_at: null };
        case 'add':
          return { kind: 'add', step_id: 'new-step', title: action.title, step_kind: action.stepKind, goal_title: action.goal.title, undone_at: null };
        case 'reading':
          return { kind: 'reading', reading_id: 'new-reading', goal_id: action.goal.id, goal_title: action.goal.title, value: action.value, unit: action.goal.unit, undone_at: null };
      }
    },
    save: async (_id, filed) => {
      saved.push(filed);
    },
    ...overrides,
  };
  return { deps, kept, applied, saved, asked };
}

describe('fileCapture', () => {
  const sentence =
    'went to the Van Alen talk, met someone from a transit nonprofit, want to volunteer there';
  const reply = {
    actions: [
      { type: 'count', step: 's1' },
      { type: 'close', step: 's2' },
      { type: 'add', parent: 'g1', title: 'Find the nonprofit’s volunteer sign-up', kind: 'claude' },
    ],
  };

  it('keeps the sentence as typed, files each move, and saves what it did', async () => {
    const { deps, kept, applied, saved, asked } = stubs(reply);
    const result = await fileCapture(`  ${sentence}\n`, '2026-09-24', deps);

    expect(kept).toEqual([`  ${sentence}\n`]);
    expect(asked[0]).toContain(sentence);
    expect(applied.map((a) => a.kind)).toEqual(['count', 'close', 'add']);
    expect(result).toEqual({ ok: true, captureId: 'capture-1', filed: saved[0] });
    expect(saved[0]!.map(describeFiled)).toEqual([
      'Counted one towards "Step events" in Goal city',
      'Closed "Step talk" in Goal city',
      'Added a step for Claude in Goal city: "Find the nonprofit’s volunteer sign-up"',
    ]);
  });

  it('keeps the sentence when the model call fails, and says so', async () => {
    const { deps, kept, saved } = stubs(reply, {
      ask: async () => ({ ok: false, error: 'Filing failed (529).' }),
    });
    const result = await fileCapture(sentence, '2026-09-24', deps);
    expect(kept).toEqual([sentence]);
    expect(saved).toEqual([]);
    expect(result).toEqual({
      ok: false,
      error: 'Filing failed (529). What you wrote is kept.',
      captureId: 'capture-1',
    });
  });

  it('leaves off a move that no longer applies or fails, and files the rest', async () => {
    let calls = 0;
    const base = stubs(reply);
    const { deps, saved } = stubs(reply, {
      apply: async (id, action) => {
        calls += 1;
        if (calls === 1) return null;
        if (calls === 2) throw new Error('network');
        return base.deps.apply(id, action);
      },
    });
    const result = await fileCapture(sentence, '2026-09-24', deps);
    expect(result.ok && result.filed.map((e) => e.kind)).toEqual(['add']);
    expect(saved[0]!.map((e) => e.kind)).toEqual(['add']);
  });

  it('keeps a sentence that matched nothing, and writes no list', async () => {
    const { deps, kept, saved } = stubs({ actions: [] });
    const result = await fileCapture('nice weather today', '2026-09-24', deps);
    expect(kept).toEqual(['nice weather today']);
    expect(saved).toEqual([]);
    expect(result).toEqual({ ok: true, captureId: 'capture-1', filed: [] });
  });

  it('refuses an empty or overlong sentence before anything is kept', async () => {
    const { deps, kept } = stubs(reply);
    expect((await fileCapture('   ', '2026-09-24', deps)).ok).toBe(false);
    expect((await fileCapture('x'.repeat(4001), '2026-09-24', deps)).ok).toBe(false);
    expect(kept).toEqual([]);
  });
});

describe('undo', () => {
  const filed: FiledEntry[] = [
    { kind: 'close', step_id: 'a', title: 'A', goal_title: 'G', undone_at: null },
    { kind: 'count', step_id: 'r', title: 'R', goal_title: 'G', starts_on: '2026-09-21', undone_at: null },
    { kind: 'add', step_id: 'n', title: 'N', step_kind: 'mine', goal_title: 'G', undone_at: null },
    { kind: 'note', goal_id: 'g', goal_title: 'G', text: 'met someone', undone_at: null },
  ];

  it('reverses only the row that line changed', () => {
    expect(filed.map(undoMove)).toEqual([
      { move: 'reopen', stepId: 'a' },
      { move: 'uncount', stepId: 'r', startsOn: '2026-09-21' },
      { move: 'archive', stepId: 'n' },
      { move: 'none' },
    ]);
  });

  it('marks that one line undone and keeps it in the list', () => {
    const next = markUndone(filed, 1, '2026-09-24T10:00:00Z');
    expect(next).toHaveLength(4);
    expect(next!.map((e) => e.undone_at)).toEqual([null, '2026-09-24T10:00:00Z', null, null]);
  });

  it('refuses a line already undone or not there', () => {
    const once = markUndone(filed, 0, 't')!;
    expect(markUndone(once, 0, 't2')).toBeNull();
    expect(markUndone(filed, 9, 't')).toBeNull();
  });

  it('reads a stored list back, skipping anything that is not an entry', () => {
    expect(readFiled([...filed, { kind: 'other' }, 'x', null])).toEqual(filed);
    expect(readFiled('nope')).toEqual([]);
  });
});

describe('readings from capture (plan #930)', () => {
  const measured = contextOf(
    [goal('debt', { unit: '$', target: 0 }), goal('city')],
    [step('talk', 'city')],
  );

  it('tells the model what a goal is measured in', () => {
    const message = captureMessage(measured, 'card balance is 4,200 now', '2026-09-24');
    expect(message).toContain('g1: Goal debt (area: The city; measured in $, target $0)');
    expect(message).toContain('g2: Goal city (area: The city)');
  });

  it('records a number against a goal with a unit, and refuses one without', () => {
    const planned = parseFiling(
      {
        actions: [
          { type: 'reading', goal: 'g1', value: 4200 },
          { type: 'reading', goal: 'g2', value: 3 },
          { type: 'reading', goal: 'g1', value: 'lots' },
        ],
      },
      measured,
    );
    expect(planned).toEqual([{ kind: 'reading', goal: measured.goals[0], value: 4200 }]);
  });

  it('reads a number the model sent as text', () => {
    const planned = parseFiling({ actions: [{ type: 'reading', goal: 'g1', value: '$4,200.50' }] }, measured);
    expect(planned).toEqual([{ kind: 'reading', goal: measured.goals[0], value: 4200.5 }]);
  });

  it('describes the line and undoes it by deleting the reading', () => {
    const entry: FiledEntry = {
      kind: 'reading',
      reading_id: 'r1',
      goal_id: 'debt',
      goal_title: 'Pay off the debts',
      value: 4200,
      unit: '$',
      undone_at: null,
    };
    expect(describeFiled(entry)).toBe('Recorded $4,200 for Pay off the debts');
    expect(undoMove(entry)).toEqual({ move: 'delete-reading', readingId: 'r1' });
    expect(readFiled([entry])).toEqual([entry]);
  });
});
