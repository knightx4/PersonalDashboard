import type { SchemaClient } from '@/lib/ask/db';
import { changeHref, changeSentence } from '@/lib/ask/change-view';
import {
  DASH_ACTION_SELECT,
  DASH_ACTIONS_TABLE,
  noUndoReason,
  toDashAction,
  undoDashAction,
  type DashAction,
  type DashActionDeps,
  type DashActionSurface,
} from '@/lib/core/dash-actions';
import type { ChangeOutcome } from '@/lib/ask/changes';
import { OPEN_PATH, parseRef, refHref } from '@/lib/core/refs';
import { moduleById, type ModuleId } from '@/lib/modules';
import { tableWorkspace } from '@/lib/sources/catalogue';
import { toDashChange } from '@/lib/talk/changes';
import { wallClockToInstant } from '@/lib/todo/time';

/**
 * What Dash changed today, for Home's "What Dash did today" (plan #1461,
 * feature #1456).
 *
 * Every change Dash makes is a row in core.dash_actions. Today's are the ones
 * written (`done_at`) since midnight in the person's zone, still standing or
 * undone since, grouped by the workspace whose table the change touched. A
 * row Dash only proposed, or one the person declined, wrote nothing and is
 * left out.
 *
 * Each row reads as one sentence. A thread, a routine or a scheduled run
 * wrote its own (`summary`), naming Dash. An Ask Dash change has none, and is
 * worded the way the Ask page words it (lib/ask/change-view.ts).
 */

/** The columns read: every change's, and the ones an Ask change is worded from. */
export const DASH_TODAY_SELECT = `${DASH_ACTION_SELECT}, conversation_id, turn_id, input, undo, declined_at`;

/** The most read for one day; a busy day of routine closes stays well under it. */
export const DASH_TODAY_LIMIT = 300;

/** What the heading of a group with no workspace says: files, watches, the account. */
export const ACROSS_THE_APP = 'Across the app';

export type DashTodayEntry = {
  id: string;
  surface: DashActionSurface;
  status: 'done' | 'undone';
  /** The sentence the person reads. */
  sentence: string;
  /** Where the row it touched opens, or null when it has no page or is gone. */
  href: string | null;
  /** When Dash made it. */
  at: string;
  workspace: ModuleId | null;
  /**
   * Why it has no Undo, shown in place of the button, for a change its
   * writer recorded as one that cannot be put back (plan #1571). Null when
   * Undo is offered.
   */
  noUndo: string | null;
};

export type DashTodayGroup = {
  workspace: ModuleId | null;
  label: string;
  entries: DashTodayEntry[];
};

type Row = Parameters<typeof toDashAction>[0] & {
  conversation_id: string | null;
  turn_id: string | null;
  input: Record<string, unknown> | null;
  undo: Record<string, unknown> | null;
  declined_at: string | null;
};

/** Midnight at the start of `today` and of the day after, in the zone, as instants. */
export function dayBounds(today: string, timezone: string): { start: string; end: string } {
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return {
    start: wallClockToInstant(today, '00:00', timezone),
    end: wallClockToInstant(next, '00:00', timezone),
  };
}

/** One row as Home lists it, or null for a row that wrote nothing. */
export function dashTodayEntry(row: Row, today: string): DashTodayEntry | null {
  const action = toDashAction(row);
  if (action.status !== 'done' && action.status !== 'undone') return null;
  const at = action.doneAt ?? action.createdAt;
  const table = action.subjectRef ? (parseRef(action.subjectRef)?.table ?? null) : null;
  const workspace = table ? tableWorkspace(table) : null;

  if (action.surface === 'ask') {
    const change = toDashChange({
      ...row,
      conversation_id: row.conversation_id ?? '',
      input: row.input ?? {},
    });
    return {
      id: action.id,
      surface: action.surface,
      status: action.status,
      sentence: `${changeSentence(change, true, today)}.`,
      href: action.status === 'done' ? changeHref(change) : null,
      at,
      workspace,
      noUndo: null,
    };
  }

  return {
    id: action.id,
    surface: action.surface,
    status: action.status,
    sentence: action.summary?.trim() || 'Dash made a change.',
    // A row Dash removed has no page to open, and one taken back may be gone.
    href:
      action.status === 'done' && action.op !== 'delete' && action.subjectRef
        ? refHref(action.subjectRef)
        : null,
    at,
    workspace,
    noUndo: action.status === 'done' ? noUndoReason(action) : null,
  };
}

/**
 * Entries in groups by workspace, newest first within each; the group with
 * the latest change comes first. `shown` leaves out a workspace switched off
 * under Account, the way Home leaves it out everywhere else.
 */
export function groupDashToday(
  entries: readonly DashTodayEntry[],
  shown: (workspace: ModuleId) => boolean = () => true,
): DashTodayGroup[] {
  const groups = new Map<ModuleId | null, DashTodayEntry[]>();
  const newest = [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  for (const entry of newest) {
    if (entry.workspace !== null && !shown(entry.workspace)) continue;
    const group = groups.get(entry.workspace);
    if (group) group.push(entry);
    else groups.set(entry.workspace, [entry]);
  }
  return [...groups].map(([workspace, list]) => ({
    workspace,
    label: workspace ? (moduleById(workspace)?.label ?? workspace) : ACROSS_THE_APP,
    entries: list,
  }));
}

/**
 * Today's changes, grouped. Reads through the person's core client, so row
 * level security keeps it to their own rows as well as the filter.
 */
export async function loadDashToday(
  core: SchemaClient,
  input: {
    userId: string;
    today: string;
    timezone: string;
    shown?: (workspace: ModuleId) => boolean;
  },
): Promise<DashTodayGroup[]> {
  const { start, end } = dayBounds(input.today, input.timezone);
  const { data, error } = await core
    .from(DASH_ACTIONS_TABLE)
    .select(DASH_TODAY_SELECT)
    .eq('user_id', input.userId)
    .in('status', ['done', 'undone'])
    .gte('done_at', start)
    .lt('done_at', end)
    .order('done_at', { ascending: false })
    .limit(DASH_TODAY_LIMIT);
  if (error) throw new Error(`Reading what Dash did today failed: ${error.message}`);
  const entries = ((data ?? []) as Row[])
    .map((row) => dashTodayEntry(row, input.today))
    .filter((entry): entry is DashTodayEntry => entry !== null);
  return groupDashToday(entries, input.shown);
}

export type DashTodayUndo =
  | { ok: true; paths: string[] }
  | { ok: false; error: string };

/**
 * Undo one of today's changes, whichever surface made it. One rule for every
 * surface (lib/core/dash-actions.ts): the row goes back to how it was, only
 * while it still holds what Dash wrote. An Ask Dash change keeps its own undo
 * (lib/ask/changes.ts), which undoDashAction says by refusing it with the
 * action in hand, so that one is handed to `undoAsk`. A line filed from
 * capture is undone by capture's own rule (plan #1569), handed to
 * `undoCapture` the same way. A refusal is the
 * sentence the person reads in place of the button. `paths` are the pages
 * besides Home that show the row, for the caller to refresh.
 */
export async function undoDashTodayWith(
  deps: DashActionDeps,
  id: string,
  undoAsk: (id: string) => Promise<ChangeOutcome>,
  askPaths: (outcome: Extract<ChangeOutcome, { ok: true }>) => string[] = () => [],
  undoCapture?: (action: DashAction) => Promise<DashTodayUndo>,
): Promise<DashTodayUndo> {
  const result = await undoDashAction(deps, id);
  if (result.ok) {
    const href = result.action.subjectRef ? refHref(result.action.subjectRef) : null;
    // A ref that opens through /open names no page to refresh by itself.
    const path = href && !href.startsWith(`${OPEN_PATH}/`) ? href.split(/[?#]/)[0] : null;
    return { ok: true, paths: path ? [path] : [] };
  }
  if (result.action?.surface === 'capture' && result.action.status === 'done' && undoCapture) {
    return undoCapture(result.action);
  }
  if (result.action?.surface !== 'ask') return { ok: false, error: result.error };
  const outcome = await undoAsk(id);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, paths: askPaths(outcome) };
}
