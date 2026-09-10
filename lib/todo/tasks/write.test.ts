import { describe, expect, it } from 'vitest';
import { resolveDue } from '@/lib/todo/tasks/write';

describe('resolveDue', () => {
  it('keeps a day with no time as a day', () => {
    // The whole point of two columns: this must not become an instant, or the
    // task moves when the reader does.
    expect(resolveDue({ dueOn: '2026-03-10', dueTime: null }, 'Asia/Tokyo')).toEqual({
      due_on: '2026-03-10',
      due_at: null,
    });
  });

  it('turns a day plus a time into an instant in the reader\'s zone', () => {
    const { due_on, due_at } = resolveDue(
      { dueOn: '2026-03-10', dueTime: '14:30' },
      'America/New_York',
    );
    expect(due_on).toBeNull();
    // 14:30 in New York on 2026-03-10 is 18:30 UTC (EDT, UTC-4).
    expect(due_at).toBe('2026-03-10T18:30:00.000Z');
  });

  it('ignores a time with no day rather than inventing today', () => {
    // Guessing the day is how a task is overdue the moment it is written.
    expect(resolveDue({ dueOn: null, dueTime: '14:30' }, 'UTC')).toEqual({
      due_on: null,
      due_at: null,
    });
  });
});
