/**
 * Areas and the goals under them, as the Goals pages read and write them
 * (docs/GOALS-SPEC.md, "The three levels"; plan #924).
 *
 * The rules that need no database live here: what a valid name, title,
 * done-when and fog are, and how a list is reordered. The reads and writes
 * are in lib/goals/store.ts.
 */

import type { HelpKindChoice } from '@/lib/goals/help-kinds';

/** The limits the table's checks set (supabase/migrations-goals/0001). */
export const AREA_NAME_MAX = 200;
export const GOAL_TITLE_MAX = 500;
export const GOAL_ACCEPTANCE_MAX = 4000;
export const GOAL_FOG_MAX = 4000;
/** supabase/migrations-goals/0029. */
export const AREA_NOTE_MAX = 4000;

export type GoalStatus = 'proposed' | 'open' | 'done' | 'dropped';

export type Area = {
  id: string;
  name: string;
  /** What you want from the area, in your own words; the brief for Plan this area. Null when unwritten. */
  note: string | null;
  position: number;
};

export type Goal = {
  id: string;
  areaId: string;
  title: string;
  /** The done-when. Null until one is written. */
  acceptance: string | null;
  /** What is not known yet about a vague goal. Null once it is clear. */
  fog: string | null;
  /** When its fog was put aside with Not now (plan #960); null while it shows. Read on the goal page only. */
  fogDismissedAt?: string | null;
  status: GoalStatus;
  position: number;
  /** What the goal is measured in, such as "$" or "lb"; null when it is not (plan #930). */
  unit: string | null;
  /** The value it is aiming for, when it has a unit and one is set. */
  target: number | null;
  /** When the goal is due, YYYY-MM-DD, or null (plan #1025). Read on the goal page only. */
  dueOn?: string | null;
  /** The kinds of weekly help it asks for (plan #1027). Read on the goal page only. */
  helpKinds?: HelpKindChoice[];
  /** The kinds Claude proposed when it mapped the goal, waiting for you (plan #1029). Goal page only. */
  proposedHelpKinds?: HelpKindChoice[];
};

export type AreaWithGoals = Area & { goals: Goal[] };

/** Areas in order, each with its goals in order. Goals whose area is not listed are left out. */
export function groupGoals(areas: Area[], goals: Goal[]): AreaWithGoals[] {
  const byArea = new Map<string, Goal[]>();
  for (const goal of goals) {
    const list = byArea.get(goal.areaId) ?? [];
    list.push(goal);
    byArea.set(goal.areaId, list);
  }
  return areas.map((area) => ({ ...area, goals: byArea.get(area.id) ?? [] }));
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Whitespace trimmed; null for nothing at all. */
function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

export function parseAreaName(raw: unknown): Parsed<string> {
  const name = clean(raw);
  if (!name) return { ok: false, error: 'Give the area a name.' };
  if (name.length > AREA_NAME_MAX) {
    return { ok: false, error: `Keep the name under ${AREA_NAME_MAX} characters.` };
  }
  return { ok: true, value: name };
}

/**
 * Words that make a title or done-when a practice rather than an outcome:
 * a rate ("one event a week", "three times a month", "every morning",
 * "weekly") or a streak ("kept for eight of the last ten weeks"). A goal is
 * the outcome a practice serves; the practice goes inside it as a rhythm
 * step (docs/GOALS-SPEC.md, "The three levels"). goals.reads_as_practice
 * (migrations-goals/0041) is the same test in SQL, which the database holds
 * Claude to; the two must agree.
 */
const PRACTICE =
  /\b(?:(?:every|each|per)\s+(?:day|week|month|weekday|weekend|morning|evening|night)|(?<!\b(?:within|in|by|for|after|than|over|under|about)\s)a\s+(?:day|week|month)|kept\s+for|daily|weekly|monthly|nightly)\b/i;

/** Whether a goal's title or done-when reads as a practice rather than an outcome. */
export function readsAsPractice(text: string | null | undefined): boolean {
  return typeof text === 'string' && PRACTICE.test(text);
}

const PRACTICE_ERROR =
  'That reads like a practice, something you do again and again. A goal is the outcome it serves, such as "Know ten people in the scene by name"; add the practice inside that goal as a rhythm step.';

/** An area's note: trimmed, and null when cleared, which is allowed. */
export function parseAreaNote(raw: unknown): Parsed<string | null> {
  const note = clean(raw);
  if (note && note.length > AREA_NOTE_MAX) {
    return { ok: false, error: `Keep the note under ${AREA_NOTE_MAX} characters.` };
  }
  return { ok: true, value: note };
}

export type GoalFields = {
  title?: string;
  acceptance?: string | null;
  fog?: string | null;
};

/**
 * The goal fields present on a form. A field that is absent is left alone; a
 * done-when or fog sent empty is cleared, which is how a vague goal stops
 * being vague. The title is the one field that cannot be cleared.
 */
export function parseGoalFields(
  get: (key: string) => unknown,
  { requireTitle = false }: { requireTitle?: boolean } = {},
): Parsed<GoalFields> {
  const fields: GoalFields = {};

  const rawTitle = get('title');
  if (rawTitle !== null && rawTitle !== undefined) {
    const title = clean(rawTitle);
    if (!title) return { ok: false, error: 'Give the goal a title.' };
    if (title.length > GOAL_TITLE_MAX) {
      return { ok: false, error: `Keep the title under ${GOAL_TITLE_MAX} characters.` };
    }
    if (readsAsPractice(title)) return { ok: false, error: PRACTICE_ERROR };
    fields.title = title;
  } else if (requireTitle) {
    return { ok: false, error: 'Give the goal a title.' };
  }

  const rawAcceptance = get('acceptance');
  if (rawAcceptance !== null && rawAcceptance !== undefined) {
    const acceptance = clean(rawAcceptance);
    if (acceptance && acceptance.length > GOAL_ACCEPTANCE_MAX) {
      return { ok: false, error: `Keep the done-when under ${GOAL_ACCEPTANCE_MAX} characters.` };
    }
    if (readsAsPractice(acceptance)) return { ok: false, error: PRACTICE_ERROR };
    fields.acceptance = acceptance;
  }

  const rawFog = get('fog');
  if (rawFog !== null && rawFog !== undefined) {
    const fog = clean(rawFog);
    if (fog && fog.length > GOAL_FOG_MAX) {
      return { ok: false, error: `Keep the note under ${GOAL_FOG_MAX} characters.` };
    }
    fields.fog = fog;
  }

  return { ok: true, value: fields };
}

/**
 * The sibling order after moving one row a place up or down, or null when it
 * is already at that end or not in the list. The caller writes positions in
 * tens from the result, so rows that share a position still move.
 */
export function reorder(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = ids.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The position for a row added at the end of a list. */
export function nextPosition(positions: number[]): number {
  return positions.length === 0 ? 10 : Math.max(...positions) + 10;
}
