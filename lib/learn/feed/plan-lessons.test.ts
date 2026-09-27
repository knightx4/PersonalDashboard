import { describe, expect, it } from 'vitest';
import { notPlanLessons } from './plan-lessons';

/** A goal's lessons are left out of Learn now (plan #1143). */
describe('notPlanLessons', () => {
  it('keeps every card but the lessons of the goal tracks', () => {
    expect(notPlanLessons(['a', 'b'])).toBe('reason.neq.lesson,subject_id.is.null,subject_id.not.in.(a,b)');
  });

  it('filters nothing when there is no goal track', () => {
    expect(notPlanLessons([])).toBeNull();
  });
});
