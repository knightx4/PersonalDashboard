import { describe, expect, it } from 'vitest';
import { moveWord } from '@/lib/core/move';
import { taskMove } from './move';

describe('taskMove', () => {
  it('puts an open todo on you', () => {
    const found = taskMove({ status: 'open' });
    expect(found && moveWord(found.move)).toBe('On you');
  });

  it('shows nothing on a ticked or dropped todo', () => {
    expect(taskMove({ status: 'done' })).toBeNull();
    expect(taskMove({ status: 'dropped' })).toBeNull();
  });
});
