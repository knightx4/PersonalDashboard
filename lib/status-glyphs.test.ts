import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from './jobs/pipeline';
import { PLAN_HEALTHS } from './plan/tree';
import {
  APPLICATION_STATUS_GLYPHS,
  FEEDBACK_HEALTH_GLYPHS,
  FINDING_HEALTH_GLYPHS,
  IDEA_HEALTH_GLYPHS,
  PLAN_HEALTH_GLYPHS,
  RAISED_HEALTH_GLYPHS,
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
   * The plan draws all fourteen of its states in one column, so two of them on
   * one shape is two rows the column cannot tell apart by shape. That is
   * allowed for exactly two groups and both are written down here, the way the
   * pipeline's sharing is. The three readings of a claim are the same rung --
   * the step is claimed -- and what separates them is whether the session is
   * still pushing, which the word and the tone carry. A blocked step and a
   * setup job are the same fact about you -- stopped, and yours to clear --
   * and what separates them is whether anybody was building when it stopped.
   * Anything else sharing a shape is a bug.
   */
  it('shares a plan shape only where the two states are the same fact', () => {
    expect(sharedBy(PLAN_HEALTH_GLYPHS)).toEqual({
      'three-quarters': ['in_progress', 'working', 'quiet'],
      bar: ['blocked', 'setup'],
    });
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
      // The three readings of a claim borrow the same rung, because they are
      // the same rung: a step somebody has in hand, the way a final round is
      // an application somebody has in hand.
      in_progress: ['final_round'],
      working: ['final_round'],
      quiet: ['final_round'],
      // A run that stopped without closing its step borrows the shape of an
      // application that ended without an offer. Both are work that was
      // underway and is not any more.
      abandoned: ['rejected'],
      done: ['offer'],
      answered: ['task done'],
      dropped: ['withdrawn', 'task dropped'],
      blocked: ['role_closed'],
      // A setup job borrows the same closed door, because it is the same
      // thing to look at: work that cannot go anywhere until somebody outside
      // it moves. A blocked step ran into that door; a setup job was written
      // in front of it.
      setup: ['role_closed'],
      waiting: ['ghosted'],
      // The one shape the plan brought with it. Nothing else in the app has a
      // state that waits on the person rather than on the work.
      unanswered: [],
    });
  });
});

/**
 * The four queues beside the plan on /dev.
 *
 * They drew their own pills until #503, so nothing made them agree. What these
 * say is that they now do: a state two queues share is one shape in both, and
 * a queue's own states are shapes only it uses.
 */
describe('the dev queue glyphs', () => {
  const MAPS = {
    feedback: FEEDBACK_HEALTH_GLYPHS,
    raised: RAISED_HEALTH_GLYPHS,
    finding: FINDING_HEALTH_GLYPHS,
    idea: IDEA_HEALTH_GLYPHS,
  } as const;

  it('gives every state a glyph from the set', () => {
    for (const map of Object.values(MAPS)) {
      for (const glyph of Object.values(map)) {
        expect(STATUS_GLYPHS).toContain(glyph);
      }
    }
  });

  it('gives each queue shapes it can tell apart in its own column', () => {
    for (const [queue, map] of Object.entries(MAPS)) {
      expect([queue, sharedBy(map)]).toEqual([queue, {}]);
    }
  });

  it('draws a row nobody is doing the same way on every queue', () => {
    expect(FEEDBACK_HEALTH_GLYPHS.dropped).toBe(PLAN_HEALTH_GLYPHS.dropped);
    expect(RAISED_HEALTH_GLYPHS.dropped).toBe(PLAN_HEALTH_GLYPHS.dropped);
    expect(FINDING_HEALTH_GLYPHS.dropped).toBe(PLAN_HEALTH_GLYPHS.dropped);
    // The word beside it is "Dismissed" rather than "Dropped", because putting
    // an idea aside is reversible. The shape is the same: nobody is doing it.
    expect(IDEA_HEALTH_GLYPHS.dropped).toBe(PLAN_HEALTH_GLYPHS.dropped);
  });

  it('draws a question waiting on you as a question, wherever it was asked', () => {
    expect(RAISED_HEALTH_GLYPHS.waiting).toBe(PLAN_HEALTH_GLYPHS.unanswered);
    expect(FINDING_HEALTH_GLYPHS.waiting).toBe(PLAN_HEALTH_GLYPHS.unanswered);
    // A proposal nobody has approved is a question on the ideas page too.
    expect(IDEA_HEALTH_GLYPHS.waiting).toBe(PLAN_HEALTH_GLYPHS.unanswered);
    expect(RAISED_HEALTH_GLYPHS.answered).toBe(PLAN_HEALTH_GLYPHS.answered);
  });

  it('draws the notes queue on the plan ladder', () => {
    expect(FEEDBACK_HEALTH_GLYPHS.ready).toBe(PLAN_HEALTH_GLYPHS.ready);
    expect(FEEDBACK_HEALTH_GLYPHS.working).toBe(PLAN_HEALTH_GLYPHS.in_progress);
    expect(FEEDBACK_HEALTH_GLYPHS.waiting).toBe(PLAN_HEALTH_GLYPHS.blocked);
    expect(FEEDBACK_HEALTH_GLYPHS.done).toBe(PLAN_HEALTH_GLYPHS.done);
    expect(IDEA_HEALTH_GLYPHS.done).toBe(PLAN_HEALTH_GLYPHS.done);
    // A raise you are finished with is the top of the same ladder: answering
    // one is a rung on the way there rather than the end of it.
    expect(RAISED_HEALTH_GLYPHS.closed).toBe(PLAN_HEALTH_GLYPHS.done);
  });

  it('draws a row handed to another queue as one waiting on something else', () => {
    // A note written into the plan and an idea shaped into a feature are both
    // waiting on a step, which is what the dashed hexagon says on the plan.
    expect(FEEDBACK_HEALTH_GLYPHS.planned).toBe(PLAN_HEALTH_GLYPHS.waiting);
    expect(IDEA_HEALTH_GLYPHS.shaped).toBe(PLAN_HEALTH_GLYPHS.waiting);
  });

  it('draws work a session still owes as ready', () => {
    expect(RAISED_HEALTH_GLYPHS.unfinished).toBe(PLAN_HEALTH_GLYPHS.ready);
    expect(FEEDBACK_HEALTH_GLYPHS.answered).toBe(PLAN_HEALTH_GLYPHS.answered);
  });

  it('draws an idea nobody has taken anywhere the way it draws a lead', () => {
    expect(IDEA_HEALTH_GLYPHS.open).toBe(APPLICATION_STATUS_GLYPHS.lead);
    expect(FINDING_HEALTH_GLYPHS.ready).toBe(PLAN_HEALTH_GLYPHS.ready);
  });
});
