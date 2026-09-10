import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from './jobs/pipeline';
import { PLAN_HEALTHS } from './plan/tree';
import {
  APPLICATION_STATUS_GLYPHS,
  PLAN_HEALTH_GLYPHS,
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

  it('gives every plan state a glyph from the set', () => {
    for (const health of PLAN_HEALTHS) {
      expect(STATUS_GLYPHS).toContain(PLAN_HEALTH_GLYPHS[health]);
    }
  });

  /**
   * The plan draws all ten of its states in one column, so unlike the pipeline
   * it can share nothing with itself: two states on one shape would be two
   * rows the column cannot tell apart.
   */
  it('gives the plan ten shapes nobody else on the page has', () => {
    expect(sharedBy(PLAN_HEALTH_GLYPHS)).toEqual({});
  });

  it('fills the plan ladder in the order the work runs', () => {
    expect(
      (['proposed', 'not_started', 'ready', 'in_progress', 'done'] as const).map(
        (health) => PLAN_HEALTH_GLYPHS[health],
      ),
    ).toEqual(['empty', 'quarter', 'half', 'three-quarters', 'full']);
  });

  /**
   * What each plan state borrows from the other two ladders, written down.
   *
   * Sharing across the ladders is the point -- somebody who has learned the
   * pipeline fills reads the plan for free -- but it is only free while it
   * means the same thing on both. This is the table of what it currently
   * means, so moving a shape has to be argued for here first.
   */
  it('borrows from the pipeline and the todo list only where the meaning carries', () => {
    const borrowed = Object.fromEntries(
      PLAN_HEALTHS.map((health) => [
        health,
        [
          ...APPLICATION_STATUSES.filter(
            (status) => APPLICATION_STATUS_GLYPHS[status] === PLAN_HEALTH_GLYPHS[health],
          ),
          ...(['open', 'done', 'dropped'] as const)
            .filter((status) => TASK_STATUS_GLYPHS[status] === PLAN_HEALTH_GLYPHS[health])
            .map((status) => `task ${status}`),
        ],
      ]),
    );

    expect(borrowed).toEqual({
      proposed: ['lead', 'drafting', 'task open'],
      not_started: ['submitted', 'acknowledged'],
      ready: ['in_process'],
      in_progress: ['final_round'],
      done: ['offer'],
      answered: ['task done'],
      dropped: ['withdrawn', 'task dropped'],
      blocked: ['role_closed'],
      waiting: ['ghosted'],
      // The one shape the plan brought with it. Nothing else in the app has a
      // state that waits on the person rather than on the work.
      unanswered: [],
    });
  });
});
