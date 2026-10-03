import { describe, expect, it } from 'vitest';
import { ARRIVAL_DAYS, dashArrivals, type CloseRow } from './dash-arrivals';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function close(id: number, rowId: string, actor: string, daysAgo: number): CloseRow {
  return { id, row_id: rowId, actor, created_at: new Date(NOW - daysAgo * DAY).toISOString() };
}

describe('dashArrivals', () => {
  it('keeps a step a Dash run closed lately', () => {
    expect(dashArrivals([close(1, 'a', 'claude', 1)], NOW)).toEqual(['a']);
  });

  it('leaves out a step you closed', () => {
    expect(dashArrivals([close(1, 'a', 'me', 1)], NOW)).toEqual([]);
  });

  it('goes by the latest close, so one of yours after Dash’s makes it yours', () => {
    expect(dashArrivals([close(2, 'a', 'me', 1), close(1, 'a', 'claude', 2)], NOW)).toEqual([]);
    expect(dashArrivals([close(1, 'a', 'me', 2), close(2, 'a', 'claude', 1)], NOW)).toEqual(['a']);
  });

  it('leaves out a close older than the window', () => {
    expect(dashArrivals([close(1, 'a', 'claude', ARRIVAL_DAYS + 1)], NOW)).toEqual([]);
  });
});
