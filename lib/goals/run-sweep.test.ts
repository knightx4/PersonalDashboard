import { describe, expect, it } from 'vitest';
import { quietRuns, type StartedRunRow } from './run-sweep';

const NOW = Date.parse('2026-09-25T12:00:00Z');

function started(id: string, extra: Partial<StartedRunRow> = {}): StartedRunRow {
  return {
    id,
    user_id: 'u1',
    created_at: '2026-09-25T11:30:00Z',
    last_seen_at: null,
    now_on: null,
    ...extra,
  };
}

describe('quietRuns (plan #1002)', () => {
  it('closes a run quiet for 45 minutes and keeps one that reported since', () => {
    const closes = quietRuns(
      [
        started('fresh'),
        started('never', { created_at: '2026-09-25T11:14:00Z' }),
        started('stopped', {
          created_at: '2026-09-25T10:00:00Z',
          last_seen_at: '2026-09-25T11:10:00Z',
          now_on: 'Find three running clubs',
        }),
        started('reporting', { created_at: '2026-09-25T09:00:00Z', last_seen_at: '2026-09-25T11:40:00Z' }),
      ],
      NOW,
    );
    expect(closes.map((c) => c.id)).toEqual(['never', 'stopped']);
    expect(closes[0]).toMatchObject({ userId: 'u1', lastSeenAt: null });
    expect(closes[0].error).toMatch(/never reported progress/);
    expect(closes[1]).toMatchObject({ lastSeenAt: '2026-09-25T11:10:00Z' });
    expect(closes[1].error).toMatch(/while on Find three running clubs/);
  });

  it('closes a run stopped halfway within the hour it stopped', () => {
    const run = started('half', { created_at: '2026-09-25T10:30:00Z', last_seen_at: '2026-09-25T11:00:00Z' });
    // Quiet for 44 minutes: still going. The overnight tick comes every four
    // minutes, so the next one after the 45th closes it.
    expect(quietRuns([run], Date.parse('2026-09-25T11:44:00Z'))).toEqual([]);
    expect(quietRuns([run], Date.parse('2026-09-25T11:48:00Z')).map((c) => c.id)).toEqual(['half']);
  });
});
