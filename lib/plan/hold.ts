/**
 * The four-week hold on new features (docs/CUT-BACK-SPEC.md part 5, plan #1484).
 *
 * Until the hold ends, a new feature is shaped only from something the person
 * wrote (a note, an idea of theirs, an answer) or from a page-view number. An
 * idea a session filed, `ideas.source = 'claude'`, waits. Feature #1480 was
 * approved on 2 October 2026, so four weeks runs through 29 October and the
 * hold lifts at the start of 30 October 2026, UTC.
 *
 * This is the one place the end date is written. The shape action on the
 * ideas page refuses with `shapeHoldReason`, and
 * .claude/skills/plan/reference/shaping.md cites this file for runs that
 * start some other way.
 */

/** The first day new features may be shaped from a session's ideas again. */
export const SESSION_IDEA_HOLD_ENDS = '2026-10-30';

const ENDS_AT = Date.parse(`${SESSION_IDEA_HOLD_ENDS}T00:00:00Z`);

/** Whether the hold is on at `now`. */
export function sessionIdeaHoldActive(now: Date = new Date()): boolean {
  return now.getTime() < ENDS_AT;
}

/**
 * Why this idea cannot be shaped yet, or null when it can. Only an idea a
 * session filed is held; one the person filed is shaped as before.
 */
export function shapeHoldReason(source: string | null | undefined, now: Date = new Date()): string | null {
  if (source !== 'claude' || !sessionIdeaHoldActive(now)) return null;
  return (
    'Not shaped: this idea was filed by a session, and until 30 October 2026 new features ' +
    'come only from something you wrote or from page-view numbers. It can be shaped from that ' +
    'date, or file it again in your own words to shape it now.'
  );
}
