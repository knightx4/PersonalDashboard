import { describe, expect, it } from 'vitest';
import { answeredSince, optionsOf, routeOf } from './session-questions';

describe('routeOf', () => {
  it('prefers the thread, then the run, then nothing', () => {
    expect(routeOf({ threadId: 't', planRunId: 'r' })).toBe('thread');
    expect(routeOf({ threadId: null, planRunId: 'r' })).toBe('plan_run');
    expect(routeOf({ threadId: null, planRunId: null })).toBe('none');
  });
});

describe('answeredSince', () => {
  const asked = '2026-11-04T10:00:00Z';
  it('counts anything the person wrote after the report', () => {
    expect(answeredSince(asked, ['2026-11-04T10:00:01Z'])).toBe(true);
  });
  it('ignores older writing, equal times and nulls', () => {
    expect(answeredSince(asked, ['2026-11-04T09:00:00Z', asked, null])).toBe(false);
    expect(answeredSince(asked, [])).toBe(false);
  });
});

describe('optionsOf', () => {
  it('keeps the readable choices and drops the rest', () => {
    expect(optionsOf(['Merge', ' ', 3, 'Wait'])).toEqual(['Merge', 'Wait']);
    expect(optionsOf(null)).toBeNull();
    expect(optionsOf([])).toBeNull();
  });
});
