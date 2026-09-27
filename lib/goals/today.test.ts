import { describe, expect, it } from 'vitest';
import { attachDependencies, type DependencyRow } from './dependencies';
import type { HomeRhythm } from './rhythms';
import { buildForest, markStartDates, type Step } from './steps';
import type { Suggestion } from './suggestions';
import { askedOfYou, rhythmBehind, TODAY_CAP, todayList, type TodayInput } from './today';
import type { Goal } from './tree';

const TODAY = '2026-09-26';

function goal(id: string, title: string, areaName: string, extra: Partial<Goal> = {}) {
  return {
    goal: {
      id,
      areaId: areaName,
      title,
      acceptance: null,
      fog: null,
      status: 'open' as const,
      position: 10,
      unit: null,
      target: null,
      ...extra,
    },
    areaName,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
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
    ...extra,
  };
}

function rhythm(id: string, goalId: string, extra: Partial<HomeRhythm> = {}): HomeRhythm {
  return {
    id,
    title: id,
    target: 1,
    period: 'week',
    goalId,
    goalTitle: goalId,
    count: 0,
    daysLeft: 2,
    atRisk: true,
    missed: 0,
    startsOn: '2026-09-21',
    ...extra,
  };
}

function suggestion(id: string, itemId: string, extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    itemId,
    kind: 'events',
    title: id,
    detail: null,
    url: null,
    place: null,
    source: null,
    happensOn: null,
    startsAt: null,
    reaction: null,
    attended: null,
    createdAt: '2026-09-20T00:00:00Z',
    ...extra,
  };
}

function input(
  goals: ReturnType<typeof goal>[],
  steps: Step[],
  more: Partial<TodayInput> & { deps?: [string, string][] } = {},
): TodayInput {
  const { byGoal, nodes } = buildForest(
    goals.map((g) => g.goal.id),
    steps,
  );
  const deps: DependencyRow[] = (more.deps ?? []).map(([itemId, dependsOnId], i) => ({
    id: `d${i}`,
    itemId,
    dependsOnId,
  }));
  attachDependencies(byGoal, nodes, deps);
  markStartDates(byGoal, TODAY);
  return {
    goals,
    byGoal,
    today: TODAY,
    rhythms: [],
    flags: [],
    suggestions: [],
    didYouGo: [],
    ...more,
  };
}

const titles = (list: { title: string }[]) => list.map((item) => item.title);

describe('todayList on the goals as they stood on 26 September', () => {
  // The open goals, areas in page order (Money, The city, Career), with the
  // live steps that bear on Today. Ids are shortened from the rows.
  const goals = [
    goal('debt', 'Pay off student debt', 'Money'),
    goal('ten', 'Know ten people in the scene by name', 'The city'),
    goal('fights', "Know how the city's planning fights work", 'The city'),
    goal('board', 'Be a regular at your community board', 'The city'),
    goal('volunteer', 'Volunteer steadily with one advocacy group', 'The city'),
    goal('speak', 'Put something of your own into the conversation', 'The city'),
    goal('role', 'Land your next role', 'Career'),
  ];
  const steps: Step[] = [
    // Debt: three results read, the rest waiting for November.
    step('schedule', 'debt', { kind: 'claude', status: 'done', result: 'The schedule' }),
    step('setup', 'debt', { title: 'Set up the payments', position: 40 }),
    step('autopay', 'setup', { title: 'Turn on autopay for every loan', startsOn: '2026-11-01' }),
    step('extra', 'setup', {
      title: 'Send the extra payment to the first loan in the order',
      position: 20,
    }),
    step('refi', 'setup', { title: 'Refinance the loans once income qualifies', position: 30 }),
    step('track', 'debt', { title: 'Keep it on track', position: 50 }),
    step('balances', 'track', {
      kind: 'rhythm',
      title: 'Log each loan balance',
      rhythmCount: 1,
      rhythmPeriod: 'month',
    }),
    // Know ten people.
    step('event', 'ten', {
      kind: 'rhythm',
      title: 'Attend one urbanism event a week',
      rhythmCount: 1,
      rhythmPeriod: 'week',
    }),
    step('names', 'ten', {
      title: 'Write down the people in the scene you already know',
      position: 20,
    }),
    // Planning fights: Claude's primer, done.
    step('primer', 'fights', { kind: 'claude', status: 'done', result: 'The primer' }),
    // Community board.
    step('find', 'board', { title: 'Find your community board and its next meeting' }),
    // Volunteering: Claude's comparison, done and unread.
    step('compare', 'volunteer', { kind: 'claude', status: 'done', result: 'Three groups' }),
    // Speaking: everything waits on the board's agenda, which waits on you.
    step('pick', 'speak', { title: 'Pick the fight you will speak on' }),
    step('agenda', 'pick', {
      kind: 'claude',
      status: 'blocked',
      blockKind: 'outside',
      title: 'List what is coming up at your community board',
      blockAsk:
        'Which community board is yours? Tell me the neighborhood or borough you live in and I will find the board and list its agendas.',
    }),
    step('choose', 'pick', { title: 'Choose the one you care about', position: 20 }),
    step('ready', 'speak', { title: 'Get the testimony ready', position: 20 }),
    step('draft', 'ready', { kind: 'claude', title: 'Draft a two-minute testimony' }),
    step('own', 'ready', { title: 'Put the draft in your own words', position: 20 }),
    step('give', 'speak', { title: 'Give it', position: 30 }),
    step('signup', 'give', { title: 'Sign up to speak and give it' }),
    // Land your next role.
    step('aim', 'role', { title: "Know what job you're aiming for" }),
    step('lowest', 'aim', {
      kind: 'claude',
      status: 'done',
      title: 'Work out the lowest pay that works for you',
      result: '$120k',
    }),
    step('floor', 'aim', { title: 'Set your pay floor', position: 30 }),
    step('settle', 'floor', { title: 'Settle on your pay floor', position: 20 }),
    step('sentence', 'aim', { title: 'Write the target down in one sentence', position: 40 }),
    step('name', 'sentence', { title: 'Name your target role and pay floor' }),
    step('point', 'sentence', {
      kind: 'claude',
      title: 'Point the job search at the target',
      position: 20,
    }),
    step('resume', 'role', { title: 'Resume and LinkedIn ready to send', position: 20 }),
    step('update', 'resume', { title: 'Update your resume with your most recent role' }),
    step('network', 'role', { title: 'Build a network that can refer you', position: 30 }),
    step('list10', 'network', { title: 'List 10 people who might know your field' }),
    step('apply', 'role', { title: 'Keep applications going out every week', position: 40 }),
    step('five', 'apply', {
      kind: 'rhythm',
      title: 'Send 5 applications',
      rhythmCount: 5,
      rhythmPeriod: 'week',
    }),
    step('worth', 'role', { title: 'Know your worth before you say yes', position: 60 }),
    step('research', 'worth', {
      kind: 'claude',
      status: 'blocked',
      blockKind: 'outside',
      title: 'Research typical pay for your target role',
      blockAsk: 'Your target title and industry decided, and a pay floor set; both are still open.',
    }),
  ];
  const deps: [string, string][] = [
    ['settle', 'lowest'],
    ['name', 'settle'],
    ['point', 'name'],
    ['choose', 'agenda'],
    ['draft', 'choose'],
    ['own', 'draft'],
    ['signup', 'own'],
  ];
  const rhythms = [
    rhythm('five', 'role', { title: 'Send 5 applications', target: 5, count: 0, daysLeft: 2 }),
    rhythm('event', 'ten', { title: 'Attend one urbanism event a week', daysLeft: 2 }),
    rhythm('balances', 'debt', { title: 'Log each loan balance', period: 'month', daysLeft: 5 }),
  ];

  it('reads pay floor, neighborhood, applications, names you know, then your board', () => {
    const list = todayList(input(goals, steps, { deps, rhythms }));
    expect(titles(list)).toEqual([
      'Settle on your pay floor',
      'Which community board is yours?',
      'Send 5 applications',
      'Write down the people in the scene you already know',
      'Find your community board and its next meeting',
    ]);
    expect(list.map((item) => item.action)).toEqual(['Done', 'Answer', 'Log one', 'Done', 'Done']);
    expect(list[1].detail).toBe(
      'Tell me the neighborhood or borough you live in and I will find the board and list its agendas.',
    );
    expect(list[2].detail).toBe('0 of 5 this week, 2 days left');
  });

  it('puts an event suggested for this week, being dated, ahead of the rhythm', () => {
    const ta = suggestion('ta', 'volunteer', {
      title: "Transportation Alternatives' volunteer info session",
      happensOn: '2026-09-28',
    });
    const list = todayList(input(goals, steps, { deps, rhythms, suggestions: [ta] }));
    expect(titles(list)).toEqual([
      'Settle on your pay floor',
      'Which community board is yours?',
      "Transportation Alternatives' volunteer info session",
      'Send 5 applications',
      'Write down the people in the scene you already know',
    ]);
  });
});

describe('todayList ranking', () => {
  const g = goal('g', 'Goal g', 'Area');

  it('ranks by steps unblocked first', () => {
    const list = todayList(
      input(
        [g],
        [step('a', 'g'), step('b', 'g'), step('c', 'g'), step('after', 'g', { position: 40 })],
        {
          deps: [
            ['after', 'b'],
            ['c', 'b'],
          ],
        },
      ),
    );
    // c waits on b, so it is not ready; b frees c and after.
    expect(list[0].id).toBe('b');
    expect(list[0].unblocks).toBe(2);
  });

  it('does not count the step above as freed', () => {
    const list = todayList(
      input([g], [step('p', 'g'), step('only', 'p', { dueOn: '2026-10-01' })]),
    );
    expect(list.find((item) => item.id === 'only')?.unblocks).toBe(0);
  });

  it('puts a step of yours ahead of a question for Dash when they unblock as much', () => {
    const list = todayList(
      input(
        [g],
        [
          step('ask', 'g', {
            kind: 'claude',
            status: 'blocked',
            blockKind: 'outside',
            blockAsk: 'Where? Say.',
          }),
          step('mine', 'g', { position: 20 }),
          step('w', 'g', { position: 30 }),
        ],
        { deps: [['w', 'mine']] },
      ),
    );
    expect(list.map((item) => item.kind)).toEqual(['step', 'ask']);
  });

  it('then by date, earliest first, with an overdue step as today', () => {
    const list = todayList(
      input(
        [g],
        [
          step('later', 'g', { dueOn: '2026-10-05' }),
          step('late', 'g', { dueOn: '2026-09-01' }),
          step('plain', 'g'),
          step('soon', 'g', { dueOn: '2026-09-28' }),
        ],
      ),
    );
    expect(list.map((item) => item.id)).toEqual(['late', 'soon', 'later', 'plain']);
    expect(list[0].on).toBe(TODAY);
  });

  it('then a rhythm about to end ahead of undated steps', () => {
    const list = todayList(
      input([g], [step('plain', 'g')], {
        rhythms: [
          rhythm('month', 'g', { period: 'month', daysLeft: 1 }),
          rhythm('week', 'g', { target: 3, count: 0, daysLeft: 1 }),
          rhythm('easy', 'g', { daysLeft: 3 }),
        ],
      }),
    );
    // "easy" still has more days than it needs, so it is not behind.
    expect(list.map((item) => item.id)).toEqual(['week', 'month', 'plain']);
  });

  it('then the goal least far through', () => {
    const busy = goal('busy', 'Busy', 'Area');
    const fresh = goal('fresh', 'Fresh', 'Area');
    const list = todayList(
      input(
        [busy, fresh],
        [step('done', 'busy', { status: 'done' }), step('b1', 'busy'), step('f1', 'fresh')],
      ),
    );
    expect(list.map((item) => item.id)).toEqual(['f1', 'b1']);
  });

  it('keeps one plain step per goal, and every step that unblocks or has a date', () => {
    const list = todayList(
      input(
        [g],
        [
          step('p1', 'g'),
          step('p2', 'g'),
          step('dated', 'g', { dueOn: '2026-10-01' }),
          step('frees', 'g'),
          step('w', 'g'),
        ],
        { deps: [['w', 'frees']] },
      ),
    );
    expect(list.map((item) => item.id).sort()).toEqual(['dated', 'frees', 'p1']);
  });

  it('includes questions, flags, did-you-go and breakdowns, and leaves results to read out', () => {
    const list = todayList(
      input(
        [g],
        [
          step('q', 'g', { kind: 'decision', title: 'Which one?' }),
          step('put-aside', 'g', { kind: 'decision', dismissedAt: '2026-09-20T00:00:00Z' }),
          step('prop', 'g', { status: 'proposed' }),
          step('res', 'g', { kind: 'claude', status: 'done', result: 'Read me' }),
        ],
        {
          flags: [{ id: 'f', title: 'The due date moved', goalId: 'g', goalTitle: 'Goal g' }],
          didYouGo: [
            suggestion('went', 'g', {
              title: 'the meetup',
              reaction: 'going',
              happensOn: '2026-09-25',
            }),
          ],
        },
      ),
    );
    expect(list.map((item) => [item.kind, item.id])).toEqual([
      ['breakdown', 'g'],
      ['went', 'went'],
      ['question', 'q'],
      ['flag', 'f'],
    ]);
    expect(list[1].title).toBe('Did you go to the meetup?');
  });

  it('caps the list at five', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      step(`s${i}`, 'g', { dueOn: `2026-10-0${i + 1}` }),
    );
    const list = todayList(input([g], many));
    expect(list).toHaveLength(TODAY_CAP);
    expect(list.map((item) => item.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('leaves out steps under a proposed or later branch, and goals not yet taken on', () => {
    const proposed = goal('prop', 'Proposed', 'Area', { status: 'proposed' });
    const list = todayList(
      input(
        [g, proposed],
        [
          step('later', 'g', { startsOn: '2026-11-01' }),
          step('under', 'later'),
          step('p-step', 'prop'),
        ],
      ),
    );
    expect(list.map((item) => item.kind)).toEqual(['plan']);
  });
});

describe('proposals to close or park a goal (plan #1084)', () => {
  const debt = goal('debt', 'Pay off student debt', 'Money');
  const board = goal('board', 'Be a regular at your community board', 'The city');

  it('puts a close with its summary early, and a park late, each with its own button', () => {
    const list = todayList(
      input([debt, board], [step('first', 'board'), step('flagged', 'debt', { dueOn: '2026-09-30' })], {
        proposals: [
          { kind: 'park', goalId: 'board', goalTitle: board.goal.title, quietDays: 23 },
          {
            kind: 'close',
            goalId: 'debt',
            goalTitle: debt.goal.title,
            summary: 'The last loan was paid off on 20 September.',
          },
        ],
      }),
    );
    expect(list.map((item) => [item.kind, item.id, item.action])).toEqual([
      ['step', 'flagged', 'Done'],
      ['close', 'debt', 'Close goal'],
      ['step', 'first', 'Done'],
      ['park', 'board', 'Park goal'],
    ]);
    expect(list[1]).toMatchObject({
      title: 'Its done-when is met: close the goal',
      detail: 'The last loan was paid off on 20 September.',
      goalId: 'debt',
    });
    expect(list[3].title).toBe('Nothing done in 23 days: park the goal');
  });
});

describe('helpers', () => {
  it('reads a question out of a Needs line', () => {
    expect(askedOfYou('Which board is yours? Tell me the borough.')).toBe('Which board is yours?');
    expect(askedOfYou('A pay floor set; still open.')).toBeNull();
    expect(askedOfYou(null)).toBeNull();
  });

  it('calls a rhythm behind when it needs at least as many as days left', () => {
    expect(rhythmBehind({ target: 5, count: 0, daysLeft: 2 })).toBe(true);
    expect(rhythmBehind({ target: 1, count: 0, daysLeft: 2 })).toBe(false);
    expect(rhythmBehind({ target: 1, count: 0, daysLeft: 1 })).toBe(true);
    expect(rhythmBehind({ target: 1, count: 1, daysLeft: 1 })).toBe(false);
  });
});
