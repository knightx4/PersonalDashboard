/**
 * Plan #1435: the form-shaped surfaces in Learn and Goals. A goal step's text
 * is edited where it is read rather than in a form opened beneath it, and
 * the ways into a Learn track are boxes you write in rather than labelled
 * fields.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-move',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/app/learn/know/actions', () => ({
  createCustomTrack: vi.fn(),
  proposeGoal: vi.fn(),
  approveChain: vi.fn(),
  proposePrior: vi.fn(),
  approvePrior: vi.fn(),
  proposeBrief: vi.fn(),
  approveBrief: vi.fn(),
  proposeFromNote: vi.fn(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');
const { CustomTrackForm } = await import('@/app/learn/know/custom-track-form');
const { GoalForm } = await import('@/app/learn/know/goal-form');
const { PriorForm } = await import('@/app/learn/know/prior-form');
const { BriefForm } = await import('@/app/learn/know/brief-form');

const GOAL = 'goal-move';

const shelf: Step = {
  id: 'shelf',
  parentId: GOAL,
  kind: 'mine',
  status: 'open',
  title: 'Put up the shelf',
  detail: 'Two brackets into the stud',
  acceptance: null,
  resolution: null,
  dismissedAt: null,
  dueOn: '2026-10-09',
  position: 10,
  rhythmCount: null,
  rhythmPeriod: null,
  onTodo: false,
  result: null,
  resultUrl: null,
  reviewedAt: null,
};

function mapOf(steps: Step[]): GoalMap {
  const forest = buildForest([GOAL], steps);
  return {
    goal: {
      id: GOAL,
      areaId: 'home',
      title: 'Settle into the apartment',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Home',
    steps: forest.byGoal.get(GOAL) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {},
    answers: {},
    threads: {},
  };
}

describe('a goal step, opened', () => {
  const html = renderToStaticMarkup(<StepTree map={mapOf([shelf])} todoOn={false} opened />);

  it('shows what it involves as text you press to edit, not a textarea', () => {
    expect(html).toContain('Two brackets into the stud');
    expect(html).toContain('title="Edit what put up the shelf involves"');
    expect(html).not.toContain('name="detail"');
  });

  it('invites a done-when where there is none', () => {
    expect(html).toContain('Done when');
    expect(html).toContain('Say when it is done');
  });

  it('carries its properties as chips that save themselves, with no Save button', () => {
    expect(html).toMatch(/name="dueOn"[^>]*value="2026-10-09"|value="2026-10-09"[^>]*name="dueOn"/);
    expect(html).not.toMatch(/>Save</);
    expect(html).toContain('>Rename<');
  });
});

describe('the ways into a Learn track', () => {
  const surfaces = {
    'make a track': renderToStaticMarkup(<CustomTrackForm />),
    'one question': renderToStaticMarkup(<GoalForm bare />),
    'what you know': renderToStaticMarkup(<PriorForm />),
    briefing: renderToStaticMarkup(
      <BriefForm subjects={[{ id: 's1', name: 'Economics' }]} maxChars={1000} />,
    ),
  };

  it.each(Object.entries(surfaces))('%s is a box you write in, with no field labels', (_, html) => {
    expect(html).not.toContain('<label');
    expect(html).toContain('focus-within:border-accent');
  });

  it('keeps the field names the actions read', () => {
    expect(surfaces['make a track']).toContain('name="name"');
    expect(surfaces['make a track']).toContain('name="want"');
    expect(surfaces['make a track']).toContain('Write the units yourself');
    expect(surfaces['one question']).toContain('name="goal"');
    expect(surfaces['what you know']).toContain('name="account"');
    expect(surfaces.briefing).toContain('name="briefing"');
    expect(surfaces.briefing).toContain('name="subjectId"');
  });
});
