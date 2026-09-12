import { describe, expect, it } from 'vitest';
import { itemInput, resolveDue } from '@/lib/todo/tasks/write';

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

describe('itemInput', () => {
  it('takes a title and trims it', () => {
    const parsed = itemInput.safeParse({ title: '  Pack the kitchen  ' });
    expect(parsed.success && parsed.data.title).toBe('Pack the kitchen');
  });

  it('refuses an item with nothing in it', () => {
    // The box under a list is one keystroke from empty, and a row with no
    // title is a row you cannot tell from the next one.
    expect(itemInput.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('holds an item to the same title length a task is held to', () => {
    expect(itemInput.safeParse({ title: 'x'.repeat(500) }).success).toBe(true);
    expect(itemInput.safeParse({ title: 'x'.repeat(501) }).success).toBe(false);
  });

  it('asks for a title and nothing else', () => {
    // An item is written mid-list. Anything else to fill in and it does not
    // get written down.
    const parsed = itemInput.safeParse({ title: 'Book the van' });
    expect(parsed.success && parsed.data).toEqual({ title: 'Book the van' });
  });
});
