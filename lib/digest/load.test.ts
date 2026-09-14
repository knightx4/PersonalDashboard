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

  it('reads the written account of the day', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      summary: 'The conversations feature went from nothing to a working list.',
      happened: [],
      attention: [],
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.summary).toBe('The conversations feature went from nothing to a working list.');
  });

  it('reads the feature a row closed under', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [
        {
          kind: 'step',
          title: 'Gather the conversations',
          ref: '#439',
          at: '2026-03-02T09:00:00Z',
          feature: { ref: '#430', title: 'One tab for your day' },
        },
      ],
      attention: [],
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.happened[0].feature).toEqual({ ref: '#430', title: 'One tab for your day' });
  });

  // Every summary written before #442 has neither, and both halves of the page
  // still have to render off one.
  it('reads a summary written before there was an account or a grouping', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [
        { kind: 'step', title: 'The panel', ref: '#42', commit: 'abc1234', note: null, at: '2026-03-02T09:00:00Z' },
      ],
      attention: [],
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.summary).toBeNull();
    expect(digest.happened[0].feature).toBeNull();
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
