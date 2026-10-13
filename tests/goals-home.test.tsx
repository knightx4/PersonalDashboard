/**
 * The Goals home (plan #1077): Dash's card with Ask Dash, Do next from the
 * steps on Todo and goals with a due date, with Dash's drafts beside their
 * steps, and lines that open to what Dash is on, what Dash did since your last visit, Later and the
 * other goals.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DoneSince } from '@/lib/goals/done-since';
import type { HomeGoal } from '@/lib/goals/home';
import type { GoalProgress } from '@/lib/goals/status';
import type { TodayItem } from '@/lib/goals/today';

// The Tooltip draws its text only while it shows, so these renders read it
// from a title on a stand-in instead (plan #1985.5).
vi.mock('@/components/ui/tooltip', async () => {
  const { createElement } = await import('react');
  return {
    Tooltip: ({ label, children }: { label: string; children: React.ReactNode }) =>
      createElement('span', { title: label }, children),
  };
});


vi.mock('@/app/goals/suggestion-actions', () => ({
  reactToSuggestionAction: vi.fn(),
  recordAttendedAction: vi.fn(),
}));
vi.mock('@/app/goals/runs/[runId]/actions', () => ({ undoRunChangeAction: vi.fn() }));
vi.mock('@/app/goals/[goalId]/actions', () => ({
  countRhythmAction: vi.fn(),
  setStepStatusAction: vi.fn(),
}));
vi.mock('@/app/goals/[goalId]/comment-actions', () => ({ addGoalComment: vi.fn() }));
vi.mock('@/app/goals/[goalId]/flag-actions', () => ({ answerFlagAction: vi.fn() }));
vi.mock('@/app/goals/[goalId]/tree-actions', () => ({ answerGoalQuestion: vi.fn() }));
vi.mock('@/app/goals/[goalId]/shaping-actions', () => ({
  askDashStepAction: vi.fn(),
  workOnGoalAction: vi.fn(),
}));
vi.mock('@/app/goals/home-actions', () => ({
  askDashAction: vi.fn(),
  setAsideAction: vi.fn(),
  restoreAsideAction: vi.fn(),
}));

const { HomeView } = await import('@/app/goals/home-view');

const progress: GoalProgress = {
  live: 5,
  done: 2,
  bands: { on_you: 2, waiting: 0, with_dash: 1, done: 2 },
  move: 'on_you',
  moves: { on_you: 2, with_dash: 1, waiting: 0, settled: 0 },
  questions: 1,
};

const goal: HomeGoal = {
  goal: {
    id: 'g1',
    areaId: 'area',
    title: 'Pay off the debts',
    acceptance: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
  },
  areaName: 'Money',
  progress,
  review: {
    id: 'r1',
    goalId: 'g1',
    verdict: 'waiting_on_you',
    reason: 'The order decides the next steps.',
    nextMove: 'Choose avalanche or snowball',
    nextOn: '2026-09-28',
    stepId: null,
    waitsOnId: null,
    runId: null,
    createdAt: '2026-09-26T06:00:00Z',
  },
  current: true,
  next: null,
  hasSteps: true,
};

function item(id: string, extra: Partial<TodayItem> = {}): TodayItem {
  return {
    kind: 'step',
    id,
    title: `Step ${id}`,
    detail: null,
    goalId: 'g1',
    goalTitle: 'Pay off the debts',
    action: 'Done',
    unblocks: 0,
    on: null,
    onTodo: true,
    ...extra,
  };
}

const done: DoneSince = {
  since: '2026-09-24T08:00:00Z',
  items: [
    {
      kind: 'result',
      id: 's9',
      title: 'Drafted the payoff order',
      goalId: 'g1',
      goalTitle: 'Pay off the debts',
      href: '/goals/g1/s/s9',
      unread: true,
      runId: 'r1',
      undo: { runId: 'r1', key: '41', state: 'undoable', reason: null },
      at: '2026-09-25T06:10:00Z',
    },
  ],
  more: 0,
};

function render(extra: Partial<Parameters<typeof HomeView>[0]> = {}): string {
  return renderToStaticMarkup(
    <HomeView
      goals={[goal]}
      onYou={[
        item('q', {
          kind: 'question',
          title: 'Avalanche or snowball?',
          action: 'Answer',
          unblocks: 3,
        }),
        item('a'),
      ]}
      done={done}
      brief={null}
      timeZone="UTC"
      {...extra}
    />,
  );
}

type GoalFields = Partial<HomeGoal['goal']>;

/** A goal line with its own id and title. */
function other(id: string, title: string, extra: GoalFields = {}): HomeGoal {
  return { ...goal, goal: { ...goal.goal, id, title, ...extra } as HomeGoal['goal'], review: null };
}

/** The line given a due date, which puts its steps in Do next. */
function dueOn(line: HomeGoal): HomeGoal {
  return { ...line, goal: { ...line.goal, dueOn: '2026-12-01' } as HomeGoal['goal'] };
}

/** Whether the fold holding Since your last visit is drawn open. */
function sinceOpen(markup: string): boolean {
  const tag = markup.lastIndexOf('<details', markup.indexOf('Since your last visit'));
  return markup.slice(tag, markup.indexOf('>', tag)).includes('open');
}

const asks = (markup: string) => markup.split('Ask Dash</button>').length - 1;

describe('the Goals home', () => {
  it('reads in one column: Dash, Do next, then the lines that open', () => {
    const html = render({
      brief: { body: 'The cake is due Sunday.\n\nThe rest of the note.', when: 'today' },
      laterOn: [
        { id: 'l1', title: 'Turn on autopay', goalId: 'g1', goalTitle: 'Pay off the debts', startsOn: '2026-11-01', dueOn: null },
      ],
      goals: [dueOn(goal), other('g2', 'Learn Spanish')],
    });
    const order = [
      'of your 2 goals',
      'The cake is due Sunday.',
      '>More<',
      'The rest of the note.',
      'Ask Dash',
      'Do next',
      'Avalanche or snowball?',
      'Nothing with Dash',
      'Since your last visit',
      'Set aside',
      'Other goals',
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const old of ['Your goals', 'On you', 'This week', 'days you visited']) {
      expect(html).not.toContain(old);
    }
  });

  it('gives each thing in Do next one button and Not now', () => {
    const html = render();
    expect(html).toContain('>Answer<');
    expect(html).toContain('>Done<');
    expect(html).toContain('Not now');
    // Ask Dash on a step of yours shows only to the owner, who alone can start a run.
    expect(asks(render({ preparable: ['a'], canRun: true }))).toBe(asks(html) + 1);
    expect(asks(render({ preparable: ['a'] }))).toBe(asks(html));
    expect(html).toContain('frees 3 steps');
  });

  it('shows Dash’s draft on the step it is for, with Open and Copy', () => {
    const html = render({
      onYou: [
        item('a', {
          title: 'Apply to Acme',
          prepared: { text: '## Cover letter\n\nDear **Acme**,\n\nI am writing\n\nFour' },
        }),
      ],
    });
    expect(html).toContain('Dash’s draft is ready');
    expect(html).toContain('Cover letter\nDear Acme,\nI am writing');
    expect(html).not.toContain('Four');
    expect(html).toContain('>Open<');
    expect(html).toContain('Copy');
    expect(html).toContain('>Done<');
  });

  it('keeps five in Do next and links to the Inbox for all of them', () => {
    const many = Array.from({ length: 7 }, (_, i) => item(`m${i}`, { title: `Errand ${i}` }));
    const html = render({ onYou: many });
    const doNext = html.slice(html.indexOf('Do next'), html.indexOf('Nothing with Dash'));
    expect(doNext).toContain('Errand 4');
    expect(doNext).not.toContain('Errand 5');
    // The other two are on the Inbox tab, not folded under the Home.
    expect(html).not.toContain('Errand 6');
    expect(doNext).toContain('All 7 in Inbox');
    expect(html).toContain('href="/goals/inbox"');
  });

  it('leaves out steps not on Todo under a goal with no due date, but not its questions', () => {
    const html = render({
      goals: [dueOn(goal), other('g2', 'Learn Spanish')],
      onYou: [
        item('a', { title: 'Pay the card' }),
        item('s', {
          title: 'Book a lesson',
          goalId: 'g2',
          goalTitle: 'Learn Spanish',
          onTodo: false,
        }),
        item('sq', {
          kind: 'question',
          title: 'Which course?',
          goalId: 'g2',
          goalTitle: 'Learn Spanish',
          action: 'Answer',
        }),
      ],
    });
    expect(html).toContain('Pay the card');
    expect(html).toContain('Which course?');
    expect(html).not.toContain('Book a lesson');
    const others = html.slice(html.indexOf('Other goals'));
    expect(others).toContain('href="/goals/g2"');
  });

  it('says what Dash is on and opens to it', () => {
    const html = render({
      dash: [
        { id: 'c1', title: 'Draft the payoff order', goalId: 'g1', goalTitle: 'Pay off the debts', kind: 'step', working: true, needs: null },
        { id: 'c2', title: 'Find the card APRs', goalId: 'g1', goalTitle: 'Pay off the debts', kind: 'step', working: false, needs: 'Which cards do you have?' },
      ],
    });
    expect(html).toContain('Dash is on 2 things');
    expect(html).toContain('1 needs an answer from you');
    expect(html).toContain('Dash is working on this now.');
    expect(html).toContain('Needs you: Which cards do you have?');
  });

  it('lists set-aside steps under Set aside with Bring back now', () => {
    const html = render({
      laterOn: [
        { id: 'l1', title: 'Turn on autopay', goalId: 'g1', goalTitle: 'Pay off the debts', startsOn: '2026-11-01', dueOn: null },
      ],
    });
    expect(html).toContain('Set aside');
    expect(html).toContain('back 1 Nov');
    expect(html).toContain('Bring back now');
    expect(render()).not.toContain('Set aside');
  });

  it('lists each other goal on one line: its status and its next move', () => {
    const waiting = { ...goal, goal: { ...goal.goal, id: 'g2', title: 'Learn Spanish' } };
    const html = render({ goals: [dueOn(goal), waiting] });
    const others = html.slice(html.indexOf('Other goals'));
    expect(others).toContain('Learn Spanish');
    expect(others).toContain('Waiting on you');
    expect(others).toContain('Next: Choose avalanche or snowball, 28 Sept');
    expect(others).not.toContain('as of');
    const stale = render({
      goals: [dueOn(goal), { ...waiting, current: false }],
    });
    expect(stale).toContain('as of');
  });

  it('keeps errands showing: in Do next when due soon, otherwise with their date', () => {
    const errand = (id: string, title: string, dueOn: string) =>
      other(id, title, { errand: true, dueOn });
    const html = render({
      goals: [
        dueOn(goal),
        errand('e2', 'Book the car service', '2026-10-20'),
        errand('e1', 'Give Sam a live show for her birthday', '2026-10-09'),
      ],
      onYou: [
        item('t1', { title: 'Buy the tickets', goalId: 'e1', goalTitle: 'Give Sam a live show' }),
      ],
      todayOn: '2026-10-02',
      areas: [{ id: 'area', name: 'Money' }],
    });
    expect(html.slice(html.indexOf('Do next'))).toContain('Buy the tickets');
    const others = html.slice(html.indexOf('Other goals'));
    expect(others).toContain('Book the car service');
    expect(others).toContain('Due 20 Oct, in 18 days');
    expect(others).not.toContain('Give Sam');
  });

  it('lists what Dash did with Read and Undo behind one line', () => {
    const html = render();
    expect(html).toContain('1 result');
    expect(html).toMatch(/href="\/goals\/g1\/s\/s9"[^>]*>Read</);
    expect(html).toContain('>Undo<');
    expect(html).toContain('Every run');
    expect(render({ done: { ...done, items: [] } })).toContain('nothing new');
    expect(render({ done: null })).toContain('could not be read just now');
  });

  it('counts the files Dash wrote that you have not opened, and lists the newest five (plan #1861)', () => {
    const files = Array.from({ length: 7 }, (_, i) => ({
      id: `f${i}`,
      title: `File number ${i}`,
      summary: null,
      madeBy: 'claude' as const,
      version: 1,
      origin: null,
      createdAt: '2026-10-12T09:00:00Z',
      updatedAt: '2026-10-12T09:00:00Z',
      readAt: null,
    }));
    const html = render({ filesToRead: files });
    expect(html).toContain('Files to read');
    expect(html).toMatch(/Files to read[\s\S]*?>7</);
    expect(html).toContain('File number 4');
    expect(html).not.toContain('File number 5');
    expect(html).toContain('All 7 on Files');
    expect(html.indexOf('Since your last visit')).toBeLessThan(html.indexOf('Files to read'));
    expect(render({ filesToRead: files.slice(0, 2) })).toContain('All files');
    expect(render({ filesToRead: [] })).not.toContain('Files to read');
    expect(render({ filesToRead: null })).not.toContain('Files to read');
  });

  it('offers goals Dash has left alone, and a new goal or errand once there is an area', () => {
    const offers = [
      { kind: 'goal' as const, goalId: 'g1', title: 'Pay off the debts', reason: 'Dash has not worked on it yet.' },
    ];
    // Only the owner's account can start a run, so only it is offered Ask Dash.
    expect(asks(render({ offers, canRun: true }))).toBe(asks(render({ offers })) + 1);
    const html = render({ canRun: true, offers });
    expect(html).toContain('it could take 1 goal');
    expect(html).toContain('Dash could take these');
    expect(html).not.toContain('A new errand');
    const withArea = render({ areas: [{ id: 'area', name: 'Money' }] });
    expect(withArea).toContain('A new errand');
    expect(withArea).toContain('A new goal');
  });

  it('welcomes you back and opens what Dash did on the day you come back', () => {
    const html = render({ awayFrom: '2026-09-18T21:30:00Z', todayOn: '2026-09-24' });
    expect(html).toContain('You were away 6 days');
    expect(sinceOpen(html)).toBe(true);
    expect(sinceOpen(render())).toBe(false);
  });

  it('offers to add a goal when there are none', () => {
    expect(render({ goals: [], onYou: [] })).toContain('No goals yet');
  });
});

describe('the other goals by area (note b4595cb6)', () => {
  it('groups goals under their areas, each area where its first goal falls', async () => {
    const { byArea } = await import('@/app/goals/goal-lanes');
    const at = (id: string, areaId: string, areaName: string): HomeGoal => ({
      ...goal,
      goal: { ...goal.goal, id, areaId },
      areaName,
    });
    const groups = byArea([at('a', 'home', 'Home'), at('b', 'money', 'Money'), at('c', 'home', 'Home')]);
    expect(groups.map((g) => [g.areaName, g.goals.map((l) => l.goal.id)])).toEqual([
      ['Home', ['a', 'c']],
      ['Money', ['b']],
    ]);
  });
});
