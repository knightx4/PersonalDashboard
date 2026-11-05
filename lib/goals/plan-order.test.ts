import { describe, expect, it } from 'vitest';
import { dailyView } from './daily';
import {
  NEXT_MAX,
  NOW_MAX,
  holderOf,
  laneOf,
  planEntries,
  planOrder,
  shownOutside,
  showsOutside,
  whoseLine,
} from './plan-order';
import type { StepNode } from './steps';
import { todoSteps } from './todo';
import type { Goal } from './tree';

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'g',
    kind: 'mine',
    status: 'open',
    title: id,
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
    children: [],
    ...extra,
  };
}

const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);

describe('planOrder', () => {
  it('orders the loans goal as its mockup: the letter now, autopay next, then the rest with what each waits on', () => {
    const save = node('save', { title: 'Save the approval letter' });
    const order = planOrder([
      node('numbers', {
        title: 'Get the numbers',
        children: [node('list', { status: 'done' }), node('check', { status: 'done' })],
      }),
      node('payments', {
        title: 'Set up the payments',
        children: [
          node('apply', { status: 'done' }),
          save,
          node('autopay', { title: 'Turn on autopay', dueOn: '2026-12-18' }),
        ],
      }),
      node('track', {
        title: 'Keep it on track',
        children: [
          node('extra', { title: 'Send the extra payment', waitsUntil: '2026-12-18' }),
          node('log', { kind: 'rhythm', rhythmPeriod: 'month', title: 'Log each balance' }),
          node('recert', {
            title: 'Recertify income',
            waitingOn: [{ id: 'save', title: 'the approval', status: 'open' }],
          }),
        ],
      }),
    ], { today: '2026-11-04' });
    // Autopay is due in six weeks, not this one, so the letter before it in the tree comes first.
    expect(ids(order.now)).toEqual(['save']);
    expect(order.now[0].stage).toEqual({ id: 'payments', title: 'Set up the payments' });
    expect(ids(order.next)).toEqual(['autopay']);
    expect(ids(order.later)).toEqual(['extra', 'log', 'recert']);
    expect(order.later.map((entry) => entry.waits)).toEqual([
      { kind: 'date', label: 'Starts 18 Dec' },
      { kind: 'rhythm', label: 'Monthly' },
      { kind: 'step', label: 'After step 1' },
    ]);
    expect(planEntries(order).map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps Now to the first step of yours, puts the following ready steps, Dash’s too, under Up next, and the rest in Later', () => {
    const order = planOrder([
      node('a'),
      node('dash', { kind: 'claude' }),
      node('b'),
      node('c'),
      node('d'),
      node('e'),
      node('f'),
    ]);
    expect(ids(order.now)).toEqual(['a']);
    expect(ids(order.next)).toEqual(['dash', 'b', 'c']);
    expect(order.next[0].whose).toBe('dash');
    // Ready, but beyond Up next: in Later, waiting on its turn.
    expect(ids(order.later)).toEqual(['d', 'e', 'f']);
    expect(order.later[0].waits).toEqual({ kind: 'step', label: 'After step 4' });
  });

  it('puts a question to answer first in Now, and a step due this week beside it', () => {
    const order = planOrder(
      [node('b'), node('a', { dueOn: '2026-11-05' }), node('q', { kind: 'decision' })],
      { today: '2026-11-04' },
    );
    expect(ids(order.now)).toEqual(['q', 'a']);
    expect(order.now[0].whose).toBe('question');
    expect(ids(order.next)).toEqual(['b']);
  });

  it('puts an overdue step before the order of the tree, and two due this week in Now by date', () => {
    const order = planOrder(
      [node('x'), node('late', { dueOn: '2026-10-01' }), node('soon', { dueOn: '2026-11-08' })],
      { today: '2026-11-04' },
    );
    expect(ids(order.now)).toEqual(['late', 'soon']);
    expect(ids(order.next)).toEqual(['x']);
  });

  it('lists every open step once, leaving out containers, closed, proposed and put-aside steps', () => {
    const order = planOrder([
      node('room', {
        title: 'Kitchen',
        children: [
          node('rack'),
          node('sub', { title: 'Shelves', children: [node('measure'), node('gone', { status: 'dropped' })] }),
        ],
      }),
      node('proposal', { status: 'proposed', children: [node('inside')] }),
      node('aside', { kind: 'decision', dismissedAt: '2026-11-01T00:00:00Z' }),
      node('answered', { kind: 'decision', resolution: 'Yes' }),
      node('done', { status: 'done' }),
    ]);
    expect(ids(planEntries(order))).toEqual(['rack', 'measure']);
    const measure = planEntries(order)[1];
    expect(measure.stage?.title).toBe('Kitchen');
    expect(measure.under).toBe('Shelves');
  });

  it('says what a blocked step needs, and holds the steps under a step blocked on you', () => {
    const order = planOrder([
      node('a'),
      node('b', { status: 'blocked', blockAsk: 'Alex to say yes', blockKind: 'outside' }),
      node('c', {
        status: 'blocked',
        blockAsk: 'The letter',
        blockKind: 'outside',
        children: [node('c1')],
      }),
    ]);
    expect(ids(order.now)).toEqual(['a']);
    // The chip says Blocked; what it needs is kept as the row's line.
    expect(order.later.map((entry) => [entry.id, entry.waits?.label, entry.waits?.detail])).toEqual([
      ['b', 'Blocked', 'Alex to say yes'],
      ['c1', 'Blocked', 'The letter'],
    ]);
  });

  it('names the person on the chip when the ask and the step both name them', () => {
    const order = planOrder([
      node('a'),
      node('map', {
        title: 'Walk through the room map with Alex',
        status: 'blocked',
        blockAsk: 'Alex free for an evening',
        blockKind: 'outside',
      }),
    ]);
    expect(order.later.map((entry) => [entry.waits?.kind, entry.waits?.label, entry.waits?.detail])).toEqual([
      ['person', 'Alex', 'Alex free for an evening'],
    ]);
  });

  it('reads a holder only from a name the step title also carries', () => {
    expect(holderOf('Alex free for an evening', 'Walk through the room map with Alex')).toBe('Alex');
    expect(holderOf('Sam’s go-ahead', 'Agree the shelves with Sam')).toBe('Sam');
    expect(holderOf('Alex to say yes', 'b')).toBeNull();
    expect(holderOf('The letter', 'Save the letter')).toBeNull();
    expect(holderOf('Waiting on the servicer', 'Waiting for the payment')).toBeNull();
    expect(holderOf('waiting on Alex', 'Talk to Alex')).toBeNull();
  });

  it('is empty for a goal with nothing open', () => {
    expect(planOrder([node('a', { status: 'done' })])).toEqual({ now: [], next: [], later: [] });
  });
});

describe('shownOutside and laneOf', () => {
  it('lets Now and Up next show away from the goal, and keeps Later on it', () => {
    const order = planOrder([
      node('a'),
      node('b', { kind: 'claude' }),
      node('w', { waitsUntil: '2027-01-01' }),
    ]);
    expect([...shownOutside(order)]).toEqual(['a', 'b']);
    expect(laneOf(order, 'w')).toBe('later');
    expect(laneOf(order, 'missing')).toBeNull();
  });
});

describe('whoseLine', () => {
  it('says whose a step is and when it is due', () => {
    const [entry] = planOrder([node('a', { dueOn: '2026-12-18' })]).now;
    expect(whoseLine(entry)).toBe('Yours · by 18 Dec');
  });
});

describe('showsOutside (plan #2778.6)', () => {
  const today = '2026-11-04';
  const goal = { id: 'g', title: 'Loans', status: 'open', areaId: 'a', activity: 'active' } as unknown as Goal;
  const forty = (extra: Record<string, Partial<StepNode>> = {}) =>
    Array.from({ length: 40 }, (_, i) => node(`s${i}`, extra[`s${i}`] ?? {}));

  it('lets through only Now and Up next on a goal with forty open steps', () => {
    const byGoal = new Map([['g', forty()]]);
    const shows = showsOutside(byGoal, today);
    const shown = byGoal.get('g')!.filter(shows).map((n) => n.id);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(NOW_MAX + NEXT_MAX);
    const home = dailyView([{ goal, areaName: 'Money' }], byGoal, today, shows);
    expect(home.goals[0].next.length).toBeLessThanOrEqual(3);
    expect(home.goals[0].next.every((item) => shown.includes(item.id))).toBe(true);
    // The home's own cap of three leaves the fourth as "more"; the other 36 are not counted.
    expect(home.goals[0].next.length + home.goals[0].more).toBe(shown.length);
  });

  it('keeps a step dated inside a week and one you put on Todo, and not one Dash sent', () => {
    const steps = forty({
      s30: { dueOn: '2026-11-09' },
      s31: { dueOn: '2026-11-20' },
      s32: { onTodo: true, onTodoBy: 'me' },
      s33: { onTodo: true, onTodoBy: 'claude' },
    });
    const byGoal = new Map([['g', steps]]);
    const shows = showsOutside(byGoal, today);
    const out = steps.filter(shows).map((n) => n.id);
    expect(out).toContain('s30');
    expect(out).toContain('s32');
    expect(out).not.toContain('s31');
    expect(out).not.toContain('s33');
    expect(todoSteps([goal], byGoal, shows).map((s) => s.id)).toEqual(['s32']);
  });
});
