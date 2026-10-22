import { describe, expect, it } from 'vitest';
import { dailyRunText } from './daily-run';
import { MENTION_DAYS, mentionLine, passiveMentions, unmentioned, type MentionState } from './passive-mentions';
import { buildForest, type Step } from './steps';
import type { Suggestion } from './suggestions';
import type { Goal } from './tree';

const TODAY = '2026-10-22';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    activity: 'passive',
    ...extra,
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

function suggestion(id: string, itemId: string, extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    itemId,
    kind: 'events',
    acceptedStepId: null,
    title: `Event ${id}`,
    detail: null,
    url: null,
    place: null,
    source: null,
    happensOn: '2026-10-24',
    startsAt: null,
    reaction: null,
    attended: null,
    createdAt: '2026-10-20T08:00:00Z',
    ...extra,
  };
}

function mentions(goals: Goal[], steps: Step[], extra: { suggestions?: Suggestion[]; states?: Map<string, MentionState> } = {}) {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  return passiveMentions({ goals, byGoal, today: TODAY, ...extra });
}

describe('passiveMentions', () => {
  it('lists a step of yours due within the week under a passive goal', () => {
    const out = mentions([goal('p', { title: 'Learn pottery' })], [step('a', 'p', { title: 'Open day', dueOn: '2026-10-25' })]);
    expect(out).toEqual([
      { ref: 'step:a', title: 'Open day', on: '2026-10-25', goalId: 'p', goalTitle: 'Learn pottery', href: '/goals/p' },
    ]);
  });

  it('leaves out an active goal, a goal that is not open, and dates outside the window', () => {
    const last = `2026-10-${22 + MENTION_DAYS}`;
    const out = mentions(
      [goal('p'), goal('act', { activity: 'active' }), goal('nul', { activity: undefined }), goal('park', { status: 'parked' })],
      [
        step('in', 'p', { dueOn: last }),
        step('late', 'p', { dueOn: '2026-10-30' }),
        step('past', 'p', { dueOn: '2026-10-21' }),
        step('act1', 'act', { dueOn: TODAY }),
        step('nul1', 'nul', { dueOn: TODAY }),
        step('park1', 'park', { dueOn: TODAY }),
      ],
    );
    expect(out.map((m) => m.ref)).toEqual(['step:in']);
  });

  it('leaves out Dash steps, questions, closed steps and steps already on Todo, and reaches sub-steps', () => {
    const out = mentions(
      [goal('p')],
      [
        step('parent', 'p'),
        step('child', 'parent', { dueOn: TODAY }),
        step('dash', 'p', { kind: 'claude', dueOn: TODAY }),
        step('q', 'p', { kind: 'decision', dueOn: TODAY }),
        step('done', 'p', { status: 'done', dueOn: TODAY }),
        step('todo', 'p', { onTodo: true, onTodoBy: 'me', dueOn: TODAY }),
      ],
    );
    expect(out.map((m) => m.ref)).toEqual(['step:child']);
  });

  it('lists an unanswered dated suggestion under a passive goal or one of its steps, soonest first', () => {
    const out = mentions([goal('p'), goal('act', { activity: 'active' })], [step('r', 'p', { kind: 'rhythm' })], {
      suggestions: [
        suggestion('later', 'p', { happensOn: '2026-10-27', url: 'https://example.test/e' }),
        suggestion('soon', 'r', { happensOn: '2026-10-23' }),
        suggestion('going', 'p', { reaction: 'going' }),
        suggestion('no', 'p', { reaction: 'not_for_me' }),
        suggestion('undated', 'p', { happensOn: null }),
        suggestion('step', 'p', { kind: 'step' }),
        suggestion('active', 'act'),
      ],
    });
    expect(out.map((m) => [m.ref, m.href])).toEqual([
      ['suggestion:soon', '/goals/p'],
      ['suggestion:later', 'https://example.test/e'],
    ]);
  });

  it('never lists a dismissed mention again', () => {
    const states = new Map<string, MentionState>([['step:a', { mentioned: true, dismissed: true }]]);
    const out = mentions([goal('p')], [step('a', 'p', { dueOn: TODAY }), step('b', 'p', { dueOn: TODAY })], { states });
    expect(out.map((m) => m.ref)).toEqual(['step:b']);
  });
});

describe('the morning brief', () => {
  it('lists only what the note has not mentioned, once, and asks for an optional line', () => {
    const all = mentions([goal('p', { title: 'Learn pottery' })], [
      step('a', 'p', { title: 'Open day', dueOn: '2026-10-24' }),
      step('b', 'p', { title: 'Kiln firing', dueOn: '2026-10-25' }),
    ]);
    const states = new Map<string, MentionState>([['step:a', { mentioned: true, dismissed: false }]]);
    const fresh = unmentioned(all, states);
    expect(fresh.map((m) => m.ref)).toEqual(['step:b']);
    expect(mentionLine(fresh[0]!)).toBe('- "Kiln firing" on 2026-10-25, under the passive goal "Learn pottery" (step b)');

    const text = dailyRunText({ userId: 'u', runId: 'r', steps: [], mentions: fresh });
    expect(text).toContain('marked optional');
    expect(text).toContain('"Kiln firing" on 2026-10-25');
    expect(text).not.toContain('Open day');
    expect(dailyRunText({ userId: 'u', runId: 'r', steps: [] })).not.toContain('marked passive');
  });
});
