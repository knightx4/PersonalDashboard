/**
 * The quick actions capture can file, in one list.
 *
 * ⌘K goes anywhere and finds anything; this is the other half -- the small set
 * of things you can *make* without leaving the page you are on. It is a
 * registry rather than a hard-coded panel because the answer to "what is a
 * note, when the app never writes to the vault" was to build the framework
 * first and leave note creation, and whatever comes after it, a row in this
 * list rather than a second surface.
 *
 * So an action is what the panel needs to know to take dictation: what it is
 * called, whose workspace the result belongs to (the mark beside it), what the
 * empty field should say, what shape the field is, and the words that should
 * find it in the palette. What it does *not* carry is a writer -- filing is
 * the module's own server action, wired where the panel is used, so nothing in
 * this file can become a second way to write a task.
 */

import { score } from '@/lib/search/score';
import type { ModuleId } from '@/lib/modules';

export type CaptureActionId = 'todo' | 'goals';

export type CaptureAction = {
  id: CaptureActionId;
  /** The panel's title, and the palette row that opens it. */
  label: string;
  /**
   * Where what you write ends up. Null would mean "belongs to no workspace",
   * which the mark draws as the home key -- honest for an action that files
   * into the account rather than into a module.
   */
  module: ModuleId | null;
  /** The field before anything is typed. */
  placeholder: string;
  /**
   * A line or a paragraph. A todo is a title, and a single line keeps Enter
   * unambiguous; a note is prose and will want the other one, which is the
   * whole reason this is a field on the action rather than a fact about the
   * panel.
   */
  field: 'line' | 'prose';
  /**
   * Whether what you file can be given a day. True for a todo, where "today"
   * and "tomorrow" are most of what anyone ever answers "when" with; false
   * for anything that is not due -- a note is written, not scheduled -- and
   * the panel draws the day chips only where it is true, so an action that
   * has no use for a date does not get two controls that do nothing.
   */
  dated: boolean;
  /**
   * What should find it, beyond its own label: "add todo" and "new task" are
   * both what somebody types when they mean this one.
   */
  keywords: readonly string[];
};

export const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  {
    id: 'todo',
    label: 'Add a todo',
    module: 'todo',
    placeholder: 'What needs doing?',
    field: 'line',
    dated: true,
    keywords: ['add todo', 'new todo', 'add task', 'new task', 'capture'],
  },
  {
    // What happened, filed against your goals by a model call (plan #929).
    // Prose, because "went to the talk, met someone, want to volunteer" is a
    // sentence and not a title.
    id: 'goals',
    label: 'Log what happened',
    module: 'goals',
    placeholder: 'What happened? It is filed against your goals.',
    field: 'prose',
    dated: false,
    keywords: ['log', 'what happened', 'log progress', 'goal progress', 'capture goal'],
  },
];

/**
 * The actions an account can use: those whose workspace it has, plus any that
 * belong to none. Filing into Goals for an account without Goals would write
 * rows it cannot see.
 */
export function availableCaptureActions(
  modules: readonly ModuleId[] | undefined,
): readonly CaptureAction[] {
  if (!modules) return CAPTURE_ACTIONS;
  return CAPTURE_ACTIONS.filter((action) => action.module === null || modules.includes(action.module));
}

/** What the shortcut and the header control open when nothing else is named. */
export const DEFAULT_CAPTURE_ACTION: CaptureActionId = 'todo';

export function captureAction(id: string): CaptureAction | null {
  return CAPTURE_ACTIONS.find((action) => action.id === id) ?? null;
}

/**
 * What a typed query is ranked against, for `lib/search/score`. Label and
 * keywords in one string so "add todo" and "task" both reach the same row,
 * ranked by the same scorer the palette ranks everything else with.
 */
export function captureHaystack(action: CaptureAction): string {
  return `${action.label} ${action.keywords.join(' ')}`;
}

/** An action a typed query names, and the words it did not use up. */
export type CaptureMatch = {
  action: CaptureAction;
  /** Ranked by the scorer the palette ranks everything else with. */
  points: number;
  /** What is left of the query: the thing to file, rather than its name. */
  seed: string;
};

/**
 * Which actions a query in the palette names, best first.
 *
 * Scored against the leading words rather than against the whole query,
 * because everything after the name is the thing being filed: "add todo ring
 * the dentist" names the action in two words and hands the panel the rest.
 * Scoring the whole string instead would lose the row on the first word of
 * the todo itself, since a subsequence match is exactly what the rest of a
 * sentence fails.
 *
 * The longest leading run that still names the action wins, so the seed is
 * what is genuinely left over rather than the first word that happened to
 * match. An empty query names nothing: the palette with nothing typed in it
 * is a list of places to go, and it stays one.
 */
export function matchCaptureActions(
  query: string,
  actions: readonly CaptureAction[] = CAPTURE_ACTIONS,
): CaptureMatch[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const matches: CaptureMatch[] = [];
  for (const action of actions) {
    const haystack = captureHaystack(action);
    for (let take = words.length; take > 0; take -= 1) {
      const points = score(haystack, words.slice(0, take).join(' '));
      if (points === null) continue;
      matches.push({ action, points, seed: words.slice(take).join(' ') });
      break;
    }
  }

  return matches.sort((a, b) => b.points - a.points);
}
