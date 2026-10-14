import { describe, expect, it } from 'vitest';
import { gapLabel } from '@/components/ui/timeline';

describe('gapLabel', () => {
  it('says nothing for a day or less', () => {
    expect(gapLabel('2026-10-13T10:00:00Z', '2026-10-12T10:00:00Z')).toBeNull();
    expect(gapLabel('2026-10-13T10:00:00Z', '2026-10-13T09:00:00Z')).toBeNull();
  });
  it('counts whole days past a day', () => {
    expect(gapLabel('2026-10-13T11:00:00Z', '2026-10-12T10:00:00Z')).toBe('1 day earlier');
    expect(gapLabel('2026-10-13T10:00:00Z', '2026-10-10T09:00:00Z')).toBe('3 days earlier');
  });
  it('moves to weeks and months for long gaps', () => {
    expect(gapLabel('2026-10-13T10:00:00Z', '2026-09-22T10:00:00Z')).toBe('3 weeks earlier');
    expect(gapLabel('2026-10-13T10:00:00Z', '2026-06-13T10:00:00Z')).toBe('4 months earlier');
  });
});
