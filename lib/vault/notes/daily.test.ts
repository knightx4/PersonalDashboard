import { describe, expect, it } from 'vitest';
import { findDailyNote } from './daily';

describe('the daily note', () => {
  it('finds the day at the top of the vault before one in a folder', () => {
    expect(findDailyNote(['Pending/2026-10-20.md', '2026-10-20.md'], '2026-10-20')).toBe('2026-10-20.md');
  });

  it('finds one filed into a folder, nearest the top first', () => {
    expect(
      findDailyNote(['Bulk/Calendar/2026-10-20.md', 'Pending/2026-10-20.md', 'Pending/2026-10-19.md'], '2026-10-20'),
    ).toBe('Pending/2026-10-20.md');
  });

  it('is null for a day with no note, and ignores names that only contain the day', () => {
    expect(findDailyNote(['2026-10-19.md', 'Notes from 2026-10-20.md', '2026-10-20.canvas'], '2026-10-20')).toBeNull();
  });
});
