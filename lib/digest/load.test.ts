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

  it('reads how many ideas the night filed, and none from a row without the count', () => {
    const row = {
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [],
      attention: [],
      created_at: '2026-03-02T12:00:00Z',
    };

    expect(digestFromRow({ ...row, ideas_filed: 3 }).ideasFiled).toBe(3);
    // Every summary written before the column existed, which is none filed
    // rather than a number nobody wrote down.
    expect(digestFromRow(row).ideasFiled).toBe(0);
    expect(digestFromRow({ ...row, ideas_filed: -2 }).ideasFiled).toBe(0);
    expect(digestFromRow({ ...row, ideas_filed: 'lots' }).ideasFiled).toBe(0);
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

  it('reads the night the runner had', () => {
    const digest = digestFromRow({
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      happened: [],
      attention: [],
      night: {
        standing: 'stopped',
        startedAt: '2026-03-01T23:00:00Z',
        endedAt: '2026-03-02T03:00:00Z',
        endedReason: 'You stopped it.',
        featuresBudget: 6,
        featuresLeft: 4,
        features: [{ ref: '#100', title: 'The runner', at: '2026-03-02T01:00:00Z' }],
        closed: [{ ref: '#101', title: 'The tick', feature: { ref: '#100', title: 'The runner' } }],
        blocked: [{ ref: '#102', title: 'The report', ask: 'Needs a token.' }],
      },
      created_at: '2026-03-02T12:00:00Z',
    });

    expect(digest.night?.endedReason).toBe('You stopped it.');
    expect(digest.night?.features).toHaveLength(1);
    expect(digest.night?.closed[0].feature).toEqual({ ref: '#100', title: 'The runner' });
    expect(digest.night?.blocked[0].ask).toBe('Needs a token.');
  });

  // A night written by a deploy that has since changed shape, and a day with
  // no night at all, both have to leave the rest of the summary standing.
  it('drops a night it cannot read and keeps the summary', () => {
    const row = {
      id: 'd1',
      day: '2026-03-02',
      since: '2026-03-01T12:00:00Z',
      summary: 'A quiet day.',
      happened: [],
      attention: [],
      created_at: '2026-03-02T12:00:00Z',
    };

    expect(digestFromRow(row).night).toBeNull();
    // No state word, so nothing can say what it was doing.
    expect(digestFromRow({ ...row, night: { startedAt: '2026-03-01T23:00:00Z' } }).night).toBeNull();
    // `off` is not a night, whatever wrote it.
    expect(
      digestFromRow({ ...row, night: { standing: 'off', startedAt: '2026-03-01T23:00:00Z' } }).night,
    ).toBeNull();
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
