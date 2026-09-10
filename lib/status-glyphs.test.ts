import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from './jobs/pipeline';
import {
  APPLICATION_STATUS_GLYPHS,
  STATUS_GLYPHS,
  TASK_STATUS_GLYPHS,
  type StatusGlyph,
} from './status-glyphs';

const TASK_STATUSES = ['open', 'done', 'dropped'] as const;

/** Which statuses ended up on each glyph, glyphs nobody uses left out. */
function sharedBy(map: Record<string, StatusGlyph>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const [status, glyph] of Object.entries(map)) {
    (groups[glyph] ??= []).push(status);
  }
  return Object.fromEntries(Object.entries(groups).filter(([, statuses]) => statuses.length > 1));
}

describe('status glyphs', () => {
  it('gives every application status a glyph from the set', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(STATUS_GLYPHS).toContain(APPLICATION_STATUS_GLYPHS[status]);
    }
  });

  it('gives every task state a glyph from the set', () => {
    for (const status of TASK_STATUSES) {
      expect(STATUS_GLYPHS).toContain(TASK_STATUS_GLYPHS[status]);
    }
  });

  /**
   * Sharing is allowed and is written down here, so adding one is a change to
   * this file rather than something that happens by accident. Two statuses on
   * one shape means the app cannot tell them apart by shape at all — for these
   * four it is deliberate, and for anything else it is a bug.
   */
  it('shares a shape only between the statuses that already share a hue', () => {
    expect(sharedBy(APPLICATION_STATUS_GLYPHS)).toEqual({
      empty: ['lead', 'drafting'],
      quarter: ['submitted', 'acknowledged'],
    });
  });

  it('keeps the terminal statuses apart, tint or no tint', () => {
    const terminal = ['rejected', 'withdrawn', 'ghosted', 'role_closed'] as const;
    const glyphs = terminal.map((status) => APPLICATION_STATUS_GLYPHS[status]);
    expect(new Set(glyphs).size).toBe(terminal.length);
  });

  it('draws an open task the way it draws a lead, and a dropped one the way it draws a withdrawal', () => {
    expect(TASK_STATUS_GLYPHS.open).toBe(APPLICATION_STATUS_GLYPHS.lead);
    expect(TASK_STATUS_GLYPHS.dropped).toBe(APPLICATION_STATUS_GLYPHS.withdrawn);
    expect(TASK_STATUS_GLYPHS.done).toBe('check');
  });
});
