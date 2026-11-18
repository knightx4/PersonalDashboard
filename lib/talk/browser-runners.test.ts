import { describe, expect, it } from 'vitest';
import { agoWords, runnerChipValue, runnerStatusSentence, runnerStatuses } from './browser-runners';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('the browser runner status (plan #3075)', () => {
  it('says neither computer has ever run it when the table is empty, as on 8 November 2026', () => {
    const statuses = runnerStatuses([], NOW);
    expect(statuses.map((s) => [s.machine, s.lastSeenAt, s.up])).toEqual([
      ['pc', null, false],
      ['mac', null, false],
    ]);
    expect(runnerStatusSentence(statuses, NOW)).toContain('has never run on your PC or your Mac');
    expect(runnerChipValue(statuses, NOW)).toEqual({ value: 'Never run', up: false });
  });

  it('counts a heartbeat under 2 minutes old as up', () => {
    const statuses = runnerStatuses([{ machine: 'pc', last_seen_at: ago(40_000) }], NOW);
    expect(statuses[0].up).toBe(true);
    expect(runnerChipValue(statuses, NOW)).toEqual({ value: 'PC up', up: true });
    expect(runnerStatusSentence(statuses, NOW)).toContain("up on your PC but did not take this");
  });

  it('says when each was last seen once neither is up', () => {
    const statuses = runnerStatuses(
      [
        { machine: 'pc', last_seen_at: ago(3 * 60 * MIN) },
        { machine: 'mac', last_seen_at: null },
      ],
      NOW,
    );
    expect(runnerStatusSentence(statuses, NOW)).toBe(
      "The browser runner isn't running: it was last seen on your PC 3 hours ago, and it has never run on your Mac.",
    );
    expect(runnerChipValue(statuses, NOW)).toEqual({ value: 'PC seen 3 hours ago', up: false });
  });

  it('reads a runner seen a few minutes ago as one that stood down because Chrome did not answer', () => {
    const statuses = runnerStatuses([{ machine: 'mac', last_seen_at: ago(4 * MIN) }], NOW);
    expect(runnerStatusSentence(statuses, NOW)).toContain(
      "last seen on your Mac 4 minutes ago, which usually means Claude in Chrome didn't answer there",
    );
  });

  it('names the most recently seen computer on the chip', () => {
    const statuses = runnerStatuses(
      [
        { machine: 'pc', last_seen_at: ago(3 * 24 * 60 * MIN) },
        { machine: 'mac', last_seen_at: ago(20 * MIN) },
      ],
      NOW,
    );
    expect(runnerChipValue(statuses, NOW).value).toBe('Mac seen 20 minutes ago');
  });

  it('words the time in its largest whole unit', () => {
    expect(agoWords(10_000)).toBe('1 minute');
    expect(agoWords(59 * MIN)).toBe('59 minutes');
    expect(agoWords(47 * 60 * MIN)).toBe('47 hours');
    expect(agoWords(72 * 60 * MIN)).toBe('3 days');
  });
});
