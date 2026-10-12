import { describe, expect, it } from 'vitest';
import { doneTodayList, type ClosedStepToday, type ProgressToday } from './done-today';

const step = (id: string, closedAt: string, extra: Partial<ClosedStepToday> = {}): ClosedStepToday => ({
  id,
  title: `Step ${id}`,
  goalId: 'clean',
  goalTitle: 'Keep the apartment clean',
  closedAt,
  ...extra,
});

const progress = (id: string, createdAt: string, extra: Partial<ProgressToday> = {}): ProgressToday => ({
  id,
  stepId: 'kitchen',
  stepTitle: 'Clean the kitchen',
  goalId: 'clean',
  goalTitle: 'Keep the apartment clean',
  text: 'wiped the counters',
  quantity: null,
  unit: null,
  createdAt,
  ...extra,
});

describe('doneTodayList (plan #1740)', () => {
  it('joins tasks, closed steps and progress, newest first, each linked where it lives', () => {
    const list = doneTodayList(
      [{ id: 't1', title: 'Pay the rent', completedAt: '2026-10-11T09:00:00Z' }],
      [step('bathroom', '2026-10-11T12:00:00Z', { title: 'Clean the bathroom' })],
      [progress('p1', '2026-10-11T10:00:00Z', { stepId: null, stepTitle: null })],
    );
    expect(list.more).toBe(0);
    expect(list.lines.map((l) => [l.kind, l.title, l.detail, l.href])).toEqual([
      ['step', 'Clean the bathroom', 'Keep the apartment clean', '/goals/clean/s/bathroom'],
      ['progress', 'wiped the counters', 'Keep the apartment clean', '/goals/clean'],
      ['task', 'Pay the rent', 'Todo', '/todo'],
    ]);
  });

  it('leaves out progress on a step that was also closed today', () => {
    const list = doneTodayList(
      [],
      [step('kitchen', '2026-10-11T12:00:00Z')],
      [progress('p1', '2026-10-11T10:00:00Z')],
    );
    expect(list.lines.map((l) => l.key)).toEqual(['step:kitchen']);
  });

  it('says the amount when no words were logged, and counts what does not fit', () => {
    const list = doneTodayList(
      [],
      [step('a', '2026-10-11T08:00:00Z'), step('b', '2026-10-11T07:00:00Z')],
      [progress('p1', '2026-10-11T10:00:00Z', { stepId: 'bags', text: '', quantity: 2, unit: 'bags' })],
      2,
    );
    expect(list.lines[0]!.title).toBe('2 bags');
    expect(list.lines).toHaveLength(2);
    expect(list.more).toBe(1);
  });
});
