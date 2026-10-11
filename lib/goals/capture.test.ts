import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { askCaptureModel } from './capture-model';
import {
  addedProgress,
  asksEstimate,
  CAPTURE_MOVE_TOOLS,
  captureContext,
  captureMessage,
  describeFiled,
  estimateAsked,
  fileCapture,
  markUndone,
  MAX_FILED,
  parseFiling,
  progressTotal,
  readFiled,
  undoMove,
  withEstimate,
  type CaptureContext,
  type FiledEntry,
  type FilingDeps,
  type PlannedAction,
} from './capture';
import { summariseProgress, type ProgressEntry } from './progress';
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
  entries: ProgressEntry[] = [],
): CaptureContext {
  const { byGoal } = buildForest(
    goals.map((g) => g.goal.id),
    steps,
  );
  return captureContext(goals, byGoal, records, summariseProgress(entries));
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
          { type: 'progress', goal: ref('friends'), text: ' met someone from a transit nonprofit ' },
          { type: 'add', parent: ref('city'), title: 'Find the volunteer sign-up', kind: 'claude' },
        ],
      },
      city,
    );
    expect(planned.map((p) => p.kind)).toEqual(['close', 'count', 'progress', 'add']);
    expect((planned[0] as Extract<PlannedAction, { kind: 'close' }>).step.id).toBe('talk');
    const progress = planned[2] as Extract<PlannedAction, { kind: 'progress' }>;
    expect(progress.text).toBe('met someone from a transit nonprofit');
    expect(progress.step).toBeNull();
    expect(progress.goal.id).toBe('friends');
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
          { type: 'progress', goal: ref('friends'), text: '   ' },
          { type: 'progress', step: ref('events'), text: 'went to one' },
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

  it('shows a rhythm that counts itself but refuses a count on it', () => {
    const jobs = contextOf(
      [goal('g')],
      [
        step('apply', 'g', {
          kind: 'rhythm',
          rhythmCount: 5,
          rhythmPeriod: 'week',
          countSource: 'applications',
        }),
      ],
      new Map([['apply', { current: period('apply', { target: 5, count: 2 }), past: [], missed: 0 }]]),
    );
    expect(captureMessage(jobs, 'sent two applications', '2026-09-24')).toContain(
      's1 [rhythm, 2 of 5 this week · from Jobs, counts itself, never count it]',
    );
    expect(parseFiling({ actions: [{ type: 'count', step: 's1' }] }, jobs)).toEqual([]);
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

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/**
 * A model that makes the moves in `input.actions` as the capture tools, all
 * in its first round with its answer, as the capture rules ask it to. What it
 * was sent is kept in `sent`.
 */
function modelMaking(input: unknown, sent: { messages: { content: unknown }[]; tools: { name: string }[] }[]) {
  const actions =
    input && typeof input === 'object' && Array.isArray((input as { actions?: unknown }).actions)
      ? ((input as { actions: Record<string, unknown>[] }).actions)
      : [];
  return {
    messages: {
      create: async (params: (typeof sent)[number]) => {
        sent.push(structuredClone(params));
        const moves = actions.map(({ type, ...fields }, i) => ({
          type: 'tool_use',
          id: `m${i}`,
          name: CAPTURE_MOVE_TOOLS[type as keyof typeof CAPTURE_MOVE_TOOLS] ?? `file_${String(type)}`,
          input: fields,
        }));
        const answer = { type: 'tool_use', id: 'a', name: 'answer', input: { answer: 'Filed it.', cited: [] } };
        return { content: [...moves, answer], stop_reason: 'tool_use', usage: USAGE };
      },
    },
  } as unknown as Anthropic;
}

/** Stubbed model and database, recording what was written. The model call runs on the shared loop. */
function stubs(input: unknown, overrides: Partial<FilingDeps> = {}) {
  const kept: string[] = [];
  const applied: PlannedAction[] = [];
  const saved: FiledEntry[][] = [];
  const asked: string[] = [];
  const sent: Parameters<typeof modelMaking>[1] = [];
  const deps: FilingDeps = {
    keep: async (body) => {
      kept.push(body);
      return 'capture-1';
    },
    context: async () => city,
    ask: async (message, file) => {
      asked.push(message);
      return askCaptureModel(
        { apiKey: 'test', captureId: 'capture-1', today: '2026-09-30', client: modelMaking(input, sent) },
        message,
        file,
      );
    },
    apply: async (_id, action) => {
      applied.push(action);
      switch (action.kind) {
        case 'close':
          return { kind: 'close', step_id: action.step.id, title: action.step.title, goal_title: action.step.goalTitle, undone_at: null };
        case 'count':
          return { kind: 'count', step_id: action.step.id, title: action.step.title, goal_title: action.step.goalTitle, starts_on: '2026-09-21', undone_at: null };
        case 'progress':
          return {
            kind: 'progress',
            entry_id: `entry-${applied.length}`,
            item_id: (action.step ?? action.goal).id,
            step_title: action.step?.title ?? null,
            goal_title: action.goal.title,
            text: action.text,
            quantity: action.quantity,
            unit: action.unit,
            happened_on: action.happenedOn ?? '2026-09-30',
            ...(progressTotal(action) ?? {}),
            ...(asksEstimate(action, progressTotal(action)) ? { ask_estimate: true } : {}),
            undone_at: null,
          };
        case 'add': {
          // As the store does: the progress it carries is logged on the new step.
          const progress = addedProgress(action, 'new-step');
          return {
            kind: 'add',
            step_id: 'new-step',
            title: action.title,
            step_kind: action.stepKind,
            goal_title: action.goal.title,
            ...(progress
              ? {
                  progress: {
                    entry_id: `entry-${applied.length}`,
                    text: progress.text,
                    quantity: progress.quantity,
                    unit: progress.unit,
                    happened_on: progress.happenedOn ?? '2026-09-30',
                    ...(progressTotal(progress) ?? {}),
                    ...(asksEstimate(progress, progressTotal(progress))
                      ? { ask_estimate: true }
                      : {}),
                  },
                }
              : {}),
            undone_at: null,
          };
        }
        case 'reading':
          return { kind: 'reading', reading_id: 'new-reading', goal_id: action.goal.id, goal_title: action.goal.title, value: action.value, unit: action.goal.unit, undone_at: null };
      }
    },
    save: async (_id, filed) => {
      saved.push(filed);
    },
    ...overrides,
  };
  return { deps, kept, applied, saved, asked, sent };
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
      'Added a step for Dash in Goal city: "Find the nonprofit’s volunteer sign-up"',
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

  it('files through the shared loop: Haiku, the five moves as tools, the sentence as the turn', async () => {
    const { deps, sent } = stubs(reply);
    await fileCapture(sentence, '2026-09-24', deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.tools.map((t) => t.name)).toEqual([
      'file_close',
      'file_count',
      'file_progress',
      'file_reading',
      'file_add',
      'answer',
    ]);
    expect(String(sent[0]!.messages[0]!.content)).toContain(sentence);
  });

  it('refuses a ref it was not shown and a repeat, and files the rest in order', async () => {
    const { deps, applied } = stubs({
      actions: [
        { type: 'close', step: 's9' },
        { type: 'close', step: 's2' },
        { type: 'close', step: 's2' },
        { type: 'note', goal: 'g1', text: 'not a tool' },
        { type: 'count', step: 's1' },
      ],
    });
    const result = await fileCapture(sentence, '2026-09-24', deps);
    expect(applied.map((a) => a.kind)).toEqual(['close', 'count']);
    expect(result.ok && result.filed.map((e) => e.kind)).toEqual(['close', 'count']);
  });

  it('says filing failed and keeps the sentence when the model call throws', async () => {
    const failing = {
      messages: {
        create: async () => {
          throw new Error('overloaded');
        },
      },
    } as unknown as Anthropic;
    const { deps, kept, saved } = stubs(reply, {
      ask: (message, file) =>
        askCaptureModel({ apiKey: 'test', captureId: 'capture-1', today: '2026-09-24', client: failing }, message, file),
    });
    const result = await fileCapture(sentence, '2026-09-24', deps);
    expect(kept).toEqual([sentence]);
    expect(saved).toEqual([]);
    expect(result).toEqual({ ok: false, error: 'Filing failed. What you wrote is kept.', captureId: 'capture-1' });
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
      { move: 'uncount', stepId: 'r', startsOn: '2026-09-21', amount: 1 },
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

describe('progress on the deepest step (plan #1275)', () => {
  // The real apartment tree: the bags step sits two deep, under the living room.
  const apartment = contextOf(
    [goal('apartment', { title: 'Make the apartment clean and livable' })],
    [
      step('living', 'apartment', { title: 'Living room' }),
      step('bags', 'living', { title: 'Move the bags to their spot' }),
      step('plan', 'apartment', { title: 'Create a plan for each room' }),
      step('clothing', 'plan', { title: 'move clothing bags to office' }),
    ],
  );
  const bags = apartment.steps.find((s) => s.id === 'bags')!;
  const sentence = 'I just moved two bags from the living room to the office';

  it('shows the model the sub-steps under their parents', () => {
    const message = captureMessage(apartment, sentence, '2026-09-30');
    expect(message).toContain('  s1 [mine]: Living room');
    expect(message).toContain(`    ${bags.ref} [mine]: Move the bags to their spot`);
  });

  it('files two bags as one progress entry on the bags step and closes nothing', async () => {
    const reply = {
      actions: [
        {
          type: 'progress',
          step: bags.ref,
          text: 'moved two bags from the living room to the office',
          quantity: 2,
          unit: 'bags',
        },
      ],
    };
    const { deps, applied, saved } = stubs(reply, { context: async () => apartment });
    const result = await fileCapture(sentence, '2026-09-30', deps);

    expect(applied).toEqual([
      {
        kind: 'progress',
        goal: apartment.goals[0],
        step: bags,
        text: 'moved two bags from the living room to the office',
        quantity: 2,
        unit: 'bags',
        happenedOn: null,
        setTotal: null,
      },
    ]);
    expect(applied.some((a) => a.kind === 'close')).toBe(false);
    expect(result.ok && result.filed).toEqual(saved[0]);
    const [entry] = saved[0]!;
    expect(describeFiled(entry!)).toBe(
      'Logged 2 bags on "Move the bags to their spot" in Make the apartment clean and livable',
    );
    expect(undoMove(entry!)).toEqual({ move: 'undo-progress', entryId: 'entry-1' });
    expect(readFiled(saved[0])).toEqual(saved[0]);
  });

  it('says what was done when there is no amount, and names the goal when no step fits', () => {
    const base = {
      kind: 'progress',
      entry_id: 'e',
      item_id: 'bags',
      step_title: 'Move the bags to their spot',
      goal_title: 'Make the apartment clean and livable',
      text: 'started on the bags',
      quantity: null,
      unit: null,
      happened_on: '2026-09-30',
      undone_at: null,
    } as const;
    expect(describeFiled(base)).toBe(
      'Logged progress on "Move the bags to their spot" in Make the apartment clean and livable: started on the bags',
    );
    expect(describeFiled({ ...base, item_id: 'apartment', step_title: null })).toBe(
      'Logged progress on Make the apartment clean and livable: started on the bags',
    );
  });

  it('drops progress with a bad ref, an amount of nothing, or a unit with no amount', () => {
    const planned = parseFiling(
      {
        actions: [
          { type: 'progress', step: 's99', text: 'moved a bag' },
          { type: 'progress', step: 's99', goal: 'g1', text: 'moved a bag' },
          { type: 'progress', goal: 'g9', text: 'moved a bag' },
          { type: 'progress', step: bags.ref, text: 'moved a bag', quantity: 0, unit: 'bags' },
          { type: 'progress', step: bags.ref, text: 'moved a bag', quantity: -2, unit: 'bags' },
          { type: 'progress', step: bags.ref, text: 'moved a bag', quantity: 'some' },
          { type: 'progress', step: bags.ref, text: 'moved a bag', unit: 'bags' },
          { type: 'progress', step: bags.ref, text: '', quantity: 2, unit: 'bags' },
        ],
      },
      apartment,
      '2026-09-30',
    );
    expect(planned).toEqual([]);
  });

  it('keeps a day the sentence named, and files a future or long-past day on today', () => {
    const at = (day: unknown) =>
      (
        parseFiling(
          { actions: [{ type: 'progress', step: bags.ref, text: 'moved a bag', day }] },
          apartment,
          '2026-09-30',
        )[0] as Extract<PlannedAction, { kind: 'progress' }>
      ).happenedOn;
    expect(at('2026-09-29')).toBe('2026-09-29');
    expect(at('2026-09-30')).toBe('2026-09-30');
    expect(at('2026-10-01')).toBeNull();
    expect(at('2026-06-01')).toBeNull();
    expect(at('2026-02-30')).toBeNull();
    expect(at('yesterday')).toBeNull();
    expect(at(null)).toBeNull();
  });

  it('reads the older goal-only note as progress on that goal', () => {
    const [planned] = parseFiling(
      { actions: [{ type: 'note', goal: 'g1', text: 'cleared the hallway' }] },
      apartment,
    );
    expect(planned).toMatchObject({ kind: 'progress', step: null, goal: apartment.goals[0] });
  });
});

describe('roughly how much is left on a step (plan #1277)', () => {
  const entry = (id: string, quantity: number, unit: string): ProgressEntry => ({
    id,
    itemId: 'bags',
    captureId: null,
    happenedOn: '2026-09-29',
    text: `moved ${quantity} ${unit}`,
    quantity,
    unit,
    estimate: null,
    createdAt: '2026-09-29T10:00:00Z',
  });
  const tree = (bagsStep: Partial<Step>, entries: ProgressEntry[] = []) =>
    contextOf(
      [goal('apartment', { title: 'Make the apartment clean and livable' })],
      [
        step('living', 'apartment', { title: 'Living room' }),
        step('bags', 'living', { title: 'Move the bags to their spot', ...bagsStep }),
      ],
      new Map(),
      entries,
    );

  it('shows filing each step’s done-when, its total and what is logged so far', () => {
    const withTotal = tree(
      { acceptance: 'Every bag is in the office', estimatedTotal: 100, totalUnit: 'bags' },
      [entry('a', 3, 'bags'), entry('b', 2, 'Bags')],
    );
    expect(captureMessage(withTotal, 'moved two bags', '2026-09-30')).toContain(
      '(done when: Every bag is in the office; total about 100 bags, 5 bags so far)',
    );
    const without = tree({ acceptance: 'All 100 bags are in the office' });
    expect(captureMessage(without, 'moved two bags', '2026-09-30')).toContain(
      '(done when: All 100 bags are in the office; no total)',
    );
  });

  it('shows the start of what Dash prepared for a step with no total', () => {
    const context = contextOf(
      [goal('apartment')],
      [
        step('bags', 'apartment', { title: 'Move the bags' }),
        step('count', 'apartment', {
          kind: 'claude',
          preparesId: 'bags',
          result: 'There are about 100 bags,\nmostly in the living room.',
        }),
      ],
    );
    expect(captureMessage(context, 'moved two bags', '2026-09-30')).toContain(
      'Dash prepared: There are about 100 bags, mostly in the living room.',
    );
  });

  it('says about 93 to go when entries add to 7 of an estimated 100', async () => {
    const context = tree({ estimatedTotal: 100, totalUnit: 'bags' }, [entry('a', 5, 'bags')]);
    const bags = context.steps.find((s) => s.id === 'bags')!;
    const reply = {
      actions: [{ type: 'progress', step: bags.ref, text: 'moved two bags', quantity: 2, unit: 'bag' }],
    };
    const { deps, saved } = stubs(reply, { context: async () => context });
    await fileCapture('moved two bags', '2026-09-30', deps);
    const [filed] = saved[0]!;
    expect(filed).toMatchObject({ total: 100, total_unit: 'bags', done: 7, total_set: false });
    expect(describeFiled(filed!)).toBe(
      'Logged 2 bag on "Move the bags to their spot" in Make the apartment clean and livable, about 93 to go of roughly 100',
    );
    expect(undoMove(filed!)).toEqual({ move: 'undo-progress', entryId: 'entry-1' });
  });

  it('sets a total read from the done-when only on a step with none, and Undo clears it', async () => {
    const context = tree({ acceptance: 'All 100 bags are in the office' }, [entry('a', 5, 'bags')]);
    const bags = context.steps.find((s) => s.id === 'bags')!;
    const reply = {
      actions: [
        { type: 'progress', step: bags.ref, text: 'moved two bags', quantity: 2, unit: 'bags', total: 100 },
      ],
    };
    const { deps, saved, applied } = stubs(reply, { context: async () => context });
    await fileCapture('moved two bags', '2026-09-30', deps);
    expect(applied[0]).toMatchObject({ setTotal: 100 });
    const [filed] = saved[0]!;
    expect(filed).toMatchObject({ total: 100, done: 7, total_set: true });
    expect(undoMove(filed!)).toEqual({
      move: 'undo-progress',
      entryId: 'entry-1',
      clearTotal: { stepId: 'bags', total: 100 },
    });

    // A step that already has a total keeps it; a total with no unit is dropped.
    const has = tree({ estimatedTotal: 80, totalUnit: 'bags' });
    const [kept] = parseFiling(
      { actions: [{ type: 'progress', step: 's2', text: 'moved two', quantity: 2, unit: 'bags', total: 100 }] },
      has,
    );
    expect(kept).toMatchObject({ setTotal: null });
    const [noUnit] = parseFiling(
      { actions: [{ type: 'progress', step: 's2', text: 'moved two', quantity: 2, total: 100 }] },
      tree({}),
    );
    expect(noUnit).toMatchObject({ setTotal: null });
  });

  it('says the estimate is reached, and nothing about a total in another unit', () => {
    const base = {
      kind: 'progress',
      entry_id: 'e',
      item_id: 'bags',
      step_title: 'Move the bags',
      goal_title: 'Apartment',
      text: 'moved the last two',
      quantity: 2,
      unit: 'bags',
      happened_on: '2026-09-30',
      total: 100,
      total_unit: 'bags',
      done: 101,
      undone_at: null,
    } as const;
    expect(describeFiled(base)).toBe(
      'Logged 2 bags on "Move the bags" in Apartment, the estimate of about 100 reached',
    );
    const boxes = tree({ estimatedTotal: 100, totalUnit: 'bags' });
    const [planned] = parseFiling(
      { actions: [{ type: 'progress', step: 's2', text: 'packed boxes', quantity: 3, unit: 'boxes' }] },
      boxes,
    );
    expect(progressTotal(planned as Extract<PlannedAction, { kind: 'progress' }>)).toBeNull();
  });
});

describe('the facts line under a step (plan #1277)', () => {
  it('is left out for a bare step and a rhythm', () => {
    const message = captureMessage(city, 'went to the Van Alen talk', '2026-09-24');
    expect(message).not.toContain('no total');
    expect(message).not.toMatch(/^\s+\(/m);
  });
});

describe('adding a step already under way (plan #1278)', () => {
  const home = contextOf(
    [goal('apartment', { title: 'Make the apartment clean and livable' })],
    [step('living', 'apartment', { title: 'Living room' })],
  );
  const living = home.steps.find((s) => s.id === 'living')!;

  it('adds "Move the bags to the office" under Living room with a 2-bag entry, and one Undo takes back both', async () => {
    const reply = {
      actions: [
        {
          type: 'add',
          parent: living.ref,
          title: 'Move the bags to the office',
          text: 'moved two bags',
          quantity: 2,
          unit: 'bags',
        },
      ],
    };
    const { deps, saved, applied } = stubs(reply, { context: async () => home });
    await fileCapture('moved two bags to the office', '2026-09-30', deps);
    expect(applied[0]).toMatchObject({
      kind: 'add',
      parent: { id: 'living' },
      title: 'Move the bags to the office',
      progress: { text: 'moved two bags', quantity: 2, unit: 'bags', happenedOn: null, setTotal: null },
    });
    const [filed] = saved[0]!;
    expect(filed).toEqual({
      kind: 'add',
      step_id: 'new-step',
      title: 'Move the bags to the office',
      step_kind: 'mine',
      goal_title: 'Make the apartment clean and livable',
      progress: {
        entry_id: 'entry-1',
        text: 'moved two bags',
        quantity: 2,
        unit: 'bags',
        happened_on: '2026-09-30',
        ask_estimate: true,
      },
      undone_at: null,
    });
    expect(describeFiled(filed!)).toBe(
      'Added a step in Make the apartment clean and livable: "Move the bags to the office", 2 bags logged',
    );
    expect(undoMove(filed!)).toEqual({
      move: 'archive',
      stepId: 'new-step',
      progress: { entryId: 'entry-1' },
    });
  });

  it('logs the entry on the new step, so progressTotal reads it like any other', () => {
    const [add] = parseFiling(
      {
        actions: [
          {
            type: 'add',
            parent: living.ref,
            title: 'Move the bags to the office',
            text: 'moved two of the ten bags',
            quantity: 2,
            unit: 'bags',
            total: 10,
            day: '2026-09-29',
          },
        ],
      },
      home,
      '2026-09-30',
    ) as Extract<PlannedAction, { kind: 'add' }>[];
    const progress = addedProgress(add!, 'new-step')!;
    expect(progress.step).toMatchObject({ id: 'new-step', depth: 2, total: null });
    expect(progress.happenedOn).toBe('2026-09-29');
    const total = progressTotal(progress);
    expect(total).toEqual({ total: 10, total_unit: 'bags', done: 2, total_set: true });
    const filed: FiledEntry = {
      kind: 'add',
      step_id: 'new-step',
      title: 'Move the bags to the office',
      step_kind: 'mine',
      goal_title: 'Apartment',
      progress: { entry_id: 'e', text: 'moved two', quantity: 2, unit: 'bags', happened_on: '2026-09-29', ...total! },
      undone_at: null,
    };
    expect(describeFiled(filed)).toBe(
      'Added a step in Apartment: "Move the bags to the office", 2 bags logged, about 8 to go of roughly 10',
    );
    expect(undoMove(filed)).toEqual({
      move: 'archive',
      stepId: 'new-step',
      progress: { entryId: 'e', clearTotal: { stepId: 'new-step', total: 10 } },
    });
  });

  it('adds a plain step when nothing was done, and drops only a bad amount', () => {
    const [plain, bad, words] = parseFiling(
      {
        actions: [
          { type: 'add', parent: living.ref, title: 'Vacuum the rug' },
          { type: 'add', parent: living.ref, title: 'Move the boxes', text: 'moved some', quantity: -1 },
          { type: 'add', parent: 'g1', title: 'Clear the hallway', text: 'started on the hallway' },
        ],
      },
      home,
    ) as Extract<PlannedAction, { kind: 'add' }>[];
    expect(plain!.progress).toBeNull();
    expect(bad!.progress).toBeNull();
    expect(words!.progress).toMatchObject({ text: 'started on the hallway', quantity: null });
    expect(
      describeFiled({
        kind: 'add',
        step_id: 'h',
        title: 'Clear the hallway',
        step_kind: 'mine',
        goal_title: 'Apartment',
        progress: { entry_id: 'e', text: 'started on the hallway', quantity: null, unit: null, happened_on: '2026-09-30' },
        undone_at: null,
      }),
    ).toBe('Added a step in Apartment: "Clear the hallway", under way: started on the hallway');
  });
});

describe('counting several at once, on the day they happened (plan #1279)', () => {
  // A weekly rhythm whose open period is the week of Monday 28 September.
  const jobs = contextOf(
    [goal('jobs', { title: 'Find a job' })],
    [
      step('apply', 'jobs', {
        title: 'Send applications',
        kind: 'rhythm',
        rhythmCount: 5,
        rhythmPeriod: 'week',
      }),
      step('portfolio', 'jobs', { title: 'Update the portfolio' }),
    ],
    new Map([
      [
        'apply',
        {
          current: period('apply', { startsOn: '2026-09-28', endsOn: '2026-10-05', target: 5 }),
          past: [],
          missed: 0,
        },
      ],
    ]),
  );
  const count = (fields: Record<string, unknown>, today = '2026-09-30') =>
    parseFiling({ actions: [{ type: 'count', step: 's1', ...fields }] }, jobs, today) as Extract<
      PlannedAction,
      { kind: 'count' }
    >[];

  it('takes an amount, one by default, and drops one that is not a whole number in range', () => {
    expect(count({})[0]).toMatchObject({ amount: 1, happenedOn: null, startsOn: '2026-09-28' });
    expect(count({ quantity: 3 })[0]!.amount).toBe(3);
    expect(count({ quantity: '3' })[0]!.amount).toBe(3);
    expect(count({ quantity: 2.5 })).toEqual([]);
    expect(count({ quantity: 0 })).toEqual([]);
    expect(count({ quantity: 101 })).toEqual([]);
    expect(count({ quantity: 'a few' })).toEqual([]);
  });

  it('counts towards the period the day falls in, and today’s for a day it cannot use', () => {
    expect(count({ day: '2026-09-29' })[0]!.startsOn).toBe('2026-09-28');
    // Yesterday from a Monday is last week.
    expect(count({ day: '2026-09-27' }, '2026-09-28')[0]).toMatchObject({
      happenedOn: '2026-09-27',
      startsOn: '2026-09-21',
    });
    expect(count({ day: '2026-10-02' })[0]).toMatchObject({ happenedOn: null, startsOn: '2026-09-28' });
    expect(count({ day: '2026-06-01' })[0]).toMatchObject({ happenedOn: null, startsOn: '2026-09-28' });
  });

  it('files "sent three applications yesterday" as 3 in yesterday’s period, and Undo takes 3 back', async () => {
    // The periods as the store keeps them, by start day: last week closed, this week open.
    const periods = new Map([
      ['2026-09-21', 4],
      ['2026-09-28', 1],
    ]);
    const { deps, saved } = stubs(
      { actions: [{ type: 'count', step: 's1', quantity: 3, day: '2026-09-27' }] },
      {
        context: async () => jobs,
        apply: async (_id, action) => {
          if (action.kind !== 'count') return null;
          periods.set(action.startsOn, (periods.get(action.startsOn) ?? 0) + action.amount);
          return {
            kind: 'count',
            step_id: action.step.id,
            title: action.step.title,
            goal_title: action.step.goalTitle,
            starts_on: action.startsOn,
            amount: action.amount,
            counted_on: action.happenedOn ?? '2026-09-28',
            undone_at: null,
          };
        },
      },
    );
    const result = await fileCapture('sent three applications yesterday', '2026-09-28', deps);
    expect(result.ok).toBe(true);
    expect([...periods]).toEqual([
      ['2026-09-21', 7],
      ['2026-09-28', 1],
    ]);
    const [line] = saved[0]!;
    expect(describeFiled(line!)).toBe('Counted 3 towards "Send applications" in Find a job');

    const undo = undoMove(line!);
    expect(undo).toEqual({ move: 'uncount', stepId: 'apply', startsOn: '2026-09-21', amount: 3 });
    if (undo.move !== 'uncount') throw new Error('expected an uncount');
    periods.set(undo.startsOn, Math.max(0, periods.get(undo.startsOn)! - undo.amount));
    expect(periods.get('2026-09-21')).toBe(4);
  });

  it('takes back one from a line filed before counts had an amount', () => {
    const old: FiledEntry = {
      kind: 'count',
      step_id: 'apply',
      title: 'Send applications',
      goal_title: 'Find a job',
      starts_on: '2026-09-21',
      undone_at: null,
    };
    expect(undoMove(old)).toEqual({ move: 'uncount', stepId: 'apply', startsOn: '2026-09-21', amount: 1 });
    expect(describeFiled(old)).toBe('Counted one towards "Send applications" in Find a job');
  });

  it('stores yesterday’s date on a progress entry filed as yesterday', async () => {
    const { deps, saved } = stubs(
      {
        actions: [
          { type: 'progress', step: 's2', text: 'rewrote the about page', day: '2026-09-29' },
        ],
      },
      { context: async () => jobs },
    );
    await fileCapture('rewrote the about page yesterday', '2026-09-30', deps);
    expect(saved[0]![0]).toMatchObject({ kind: 'progress', item_id: 'portfolio', happened_on: '2026-09-29' });
  });
});

describe('asking once how far along a step is (plan #1280)', () => {
  const entry = (id: string): ProgressEntry => ({
    id,
    itemId: 'bags',
    captureId: null,
    happenedOn: '2026-09-29',
    text: 'moved some bags',
    quantity: null,
    unit: null,
    estimate: null,
    createdAt: '2026-09-29T10:00:00Z',
  });
  const tree = (bagsStep: Partial<Step>, entries: ProgressEntry[] = []) =>
    contextOf(
      [goal('apartment', { title: 'Apartment' })],
      [
        step('living', 'apartment', { title: 'Living room' }),
        step('bags', 'living', { title: 'Move the bags', ...bagsStep }),
      ],
      new Map(),
      entries,
    );
  const fileOn = async (context: CaptureContext, move: Record<string, unknown>) => {
    const { deps, saved } = stubs({ actions: [move] }, { context: async () => context });
    await fileCapture('moved two bags', '2026-09-30', deps);
    return saved[0]![0]!;
  };

  it('asks after the first entry on a step with no total, and a tap keeps the answer', async () => {
    const context = tree({});
    const bags = context.steps.find((s) => s.id === 'bags')!;
    expect(bags.logged).toBe(0);
    const filed = await fileOn(context, { type: 'progress', step: bags.ref, text: 'moved two bags', quantity: 2, unit: 'bags' });
    expect(filed).toMatchObject({ kind: 'progress', ask_estimate: true });
    expect(estimateAsked(filed)).toBe('entry-1');

    const answered = withEstimate([filed], 0, 'half');
    expect(answered![0]).toMatchObject({ estimate: 'half' });
    // Answered, the chips go and a second tap is refused.
    expect(estimateAsked(answered![0]!)).toBeNull();
    expect(withEstimate(answered!, 0, 'nearly')).toBeNull();
    // Undone, it is not asking either.
    expect(estimateAsked({ ...filed, undone_at: '2026-09-30T10:00:00Z' })).toBeNull();
  });

  it('does not come back for a step that already has an entry, answered or not', async () => {
    const context = tree({}, [entry('a')]);
    const bags = context.steps.find((s) => s.id === 'bags')!;
    expect(bags.logged).toBe(1);
    const filed = await fileOn(context, { type: 'progress', step: bags.ref, text: 'moved two more' });
    expect(filed).not.toHaveProperty('ask_estimate');
    expect(estimateAsked(filed)).toBeNull();
  });

  it('does not ask on a step with a total, one this line sets, or the goal itself', async () => {
    const withTotal = tree({ estimatedTotal: 100, totalUnit: 'bags' });
    const bags = withTotal.steps.find((s) => s.id === 'bags')!;
    expect(
      estimateAsked(await fileOn(withTotal, { type: 'progress', step: bags.ref, text: 'moved two', quantity: 2, unit: 'bags' })),
    ).toBeNull();

    const settingOne = tree({ acceptance: 'All 100 bags are in the office' });
    expect(
      estimateAsked(
        await fileOn(settingOne, { type: 'progress', step: bags.ref, text: 'moved two', quantity: 2, unit: 'bags', total: 100 }),
      ),
    ).toBeNull();

    expect(estimateAsked(await fileOn(tree({}), { type: 'progress', goal: 'g1', text: 'tidied up' }))).toBeNull();
  });

  it('asks on a step added already under way, and keeps the answer on its progress', async () => {
    const context = tree({});
    const living = context.steps.find((s) => s.id === 'living')!;
    const filed = await fileOn(context, {
      type: 'add',
      parent: living.ref,
      title: 'Move the bags to the office',
      text: 'moved two bags',
      quantity: 2,
      unit: 'bags',
    });
    expect(estimateAsked(filed)).toBe('entry-1');
    const [answered] = withEstimate([filed], 0, 'started')!;
    expect(answered).toMatchObject({ kind: 'add', progress: { entry_id: 'entry-1', estimate: 'started' } });
    expect(estimateAsked(answered!)).toBeNull();

    // A plain add has nothing to ask about.
    const plain = await fileOn(context, { type: 'add', parent: living.ref, title: 'Sweep' });
    expect(estimateAsked(plain)).toBeNull();
  });

  it('never asks on a line filed before', () => {
    const old: FiledEntry = {
      kind: 'progress',
      entry_id: 'e',
      item_id: 'bags',
      step_title: 'Move the bags',
      goal_title: 'Apartment',
      text: 'moved two',
      quantity: 2,
      unit: 'bags',
      happened_on: '2026-09-29',
      undone_at: null,
    };
    expect(estimateAsked(old)).toBeNull();
    expect(withEstimate([old], 0, 'half')).toBeNull();
  });
});
