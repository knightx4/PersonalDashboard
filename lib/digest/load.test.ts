import { describe, expect, it } from 'vitest';
import { digestFromRow } from '@/lib/digest/load';

describe('digestFromRow', () => {
  it('reads a row the cron wrote', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [
        { kind: 'step', title: 'The panel', ref: '#42', commit: 'abc1234', note: null, at: '2026-03-02T09:00:00Z' },
      ],
      attention: [{ kind: 'suggestion', title: 'Two questions hold up #338', ref: null, detail: null }],
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.day).toBe('2026-03-02');
    expect(digest.happened).toHaveLength(1);
    expect(digest.attention[0].kind).toBe('suggestion');
  });

  it('drops an entry an older deploy wrote in a shape this one does not know', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [{ kind: 'sideways', title: 'Something' }, { kind: 'step' }, 'not an entry'],
      attention: 'not an array',
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.happened).toEqual([]);
    expect(digest.attention).toEqual([]);
  });
});
