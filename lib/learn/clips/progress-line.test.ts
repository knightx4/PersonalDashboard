import { describe, expect, it } from 'vitest';
import { clipProgressLine, nextLibraryRun, untilLabel } from './progress-line';

const at = (iso: string) => new Date(iso);

describe('nextLibraryRun', () => {
  it('is the next 53 past 01, 07, 13 or 19 UTC', () => {
    expect(nextLibraryRun(at('2026-10-02T18:36:00Z')).toISOString()).toBe('2026-10-02T19:53:00.000Z');
    expect(nextLibraryRun(at('2026-10-02T13:53:00Z')).toISOString()).toBe('2026-10-02T19:53:00.000Z');
  });

  it('rolls over to the next day after the 19:53 run', () => {
    expect(nextLibraryRun(at('2026-10-02T20:00:00Z')).toISOString()).toBe('2026-10-03T01:53:00.000Z');
  });
});

describe('untilLabel', () => {
  it('counts minutes under an hour and rounds hours above it', () => {
    const now = at('2026-10-02T19:13:00Z');
    expect(untilLabel(at('2026-10-02T19:53:00Z'), now)).toBe('in 40 minutes');
    expect(untilLabel(at('2026-10-02T22:20:00Z'), now)).toBe('in about 3 hours');
  });
});

describe('clipProgressLine', () => {
  const now = at('2026-10-02T18:36:00Z');
  const nextRunAt = at('2026-10-02T19:53:00Z');

  it('says nothing is cut yet and when the first batch comes', () => {
    expect(
      clipProgressLine(
        { playlist: { cut: 0, total: 47 }, channel: { cut: 0, total: 350 }, clips: 0, scored: 0, nextRunAt },
        now,
      ),
    ).toBe('Clips: 0 of 47 of your videos cut · 0 of 350 from channels Learn follows · no clips yet · next batch in about 1 hour');
  });

  it('counts clips ready and ranked part way through', () => {
    expect(
      clipProgressLine(
        { playlist: { cut: 12, total: 47 }, channel: { cut: 0, total: 350 }, clips: 85, scored: 60, nextRunAt },
        now,
      ),
    ).toBe('Clips: 12 of 47 of your videos cut · 0 of 350 from channels Learn follows · 85 clips ready, 60 ranked · next batch in about 1 hour');
  });

  it('drops the next batch once everything is cut', () => {
    expect(
      clipProgressLine(
        { playlist: { cut: 47, total: 47 }, channel: { cut: 0, total: 0 }, clips: 400, scored: 400, nextRunAt },
        now,
      ),
    ).toBe('Clips: 47 of 47 of your videos cut · 400 clips ready');
  });
});
