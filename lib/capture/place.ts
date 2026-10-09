/**
 * What the one capture box shows and files (plan #1581, feature #1579).
 *
 * The box asks the sorter (lib/capture/sort.ts) where a sentence belongs
 * while it is typed, says so on the line under the field, and on Enter files
 * each part through the writer its workspace already has
 * (app/capture-actions.ts). This file is the part with no server in it: which
 * places are offered, how the line names a part, what Enter files given what
 * the box showed, and how the box names where each part went.
 *
 * No `server-only` guard, so the box imports it.
 */

import { moduleById, type ModuleId } from '@/lib/modules';
import { goalsPlaceName, todoDayName, type CaptureDestination } from '@/lib/capture/destination';
import {
  availableCapturePlaces,
  CAPTURE_PLACE_LABELS,
  CAPTURE_PLACE_MODULE,
  roleName,
  type CapturePart,
  type CapturePlace,
  type CaptureSort,
  type CaptureSortRole,
} from '@/lib/capture/sort';
import type { FiledEntry } from '@/lib/goals/capture';
import { INBOX_FOLDER } from '@/lib/vault/paths';

/**
 * The places the box can file into. The vault is one only while its token
 * can write (plan #1582): an account whose vault is read-only is never
 * offered it, and capture keeps the other places.
 */
export const LIVE_CAPTURE_PLACES: readonly CapturePlace[] = ['todo', 'goals', 'jobs', 'vault'];

/**
 * The places offered to an account: live, and in a workspace it has. The
 * vault only when the server has found its token can write, so the box,
 * which cannot ask GitHub, leaves it out until a sort says otherwise.
 */
export function offeredCapturePlaces(
  modules: readonly ModuleId[] | undefined,
  options: { vaultWritable?: boolean } = {},
): CapturePlace[] {
  return availableCapturePlaces(modules).filter(
    (place) => LIVE_CAPTURE_PLACES.includes(place) && (place !== 'vault' || options.vaultWritable === true),
  );
}

/** How the line under the field names one part: "Update a goal · Run a half marathon". */
export function capturePartLabel(part: Pick<CapturePart, 'place' | 'goal' | 'role'>): string {
  const label = CAPTURE_PLACE_LABELS[part.place];
  if (part.place === 'goals' && part.goal) return `${label} · ${part.goal.title}`;
  if (part.place === 'jobs' && part.role) return `${label} · ${roleName(part.role)}`;
  return label;
}

/**
 * What Enter files, given what the box showed: the place the person picked,
 * or the sort when it was sure. A pick files the whole sentence in one place,
 * keeping the role the sort named when the pick is a job. `ask` when there is
 * neither, so nothing is filed against a guess; `sort` is the box's to ask
 * for first when it has none yet.
 */
export type CaptureFiling =
  | { kind: 'file'; parts: CapturePart[] }
  | { kind: 'ask' }
  | { kind: 'sort' };

export function captureFiling(
  sentence: string,
  sort: CaptureSort | null,
  picked: CapturePlace | null,
): CaptureFiling {
  const whole = sentence.trim();
  if (picked) {
    const role = sort?.parts.find((part) => part.place === 'jobs')?.role ?? null;
    const goal = sort?.parts.find((part) => part.place === 'goals')?.goal ?? null;
    return {
      kind: 'file',
      parts: [
        {
          place: picked,
          text: whole,
          goal: picked === 'goals' ? goal : null,
          role: picked === 'jobs' ? role : null,
        },
      ],
    };
  }
  if (!sort) return { kind: 'sort' };
  if (!sort.sure || sort.parts.length === 0) return { kind: 'ask' };
  return { kind: 'file', parts: sort.parts };
}

/** One part, once filed: where it went and what undoes it. */
export type FiledCapture = {
  place: CapturePlace;
  /** The words filed. */
  text: string;
  /** Where it went, as the box and the landing name it: "Todo · Today". */
  where: string;
  /** The workspace's home, which the landing flies to. */
  href: string;
  /**
   * The core.dash_actions record a todo, a job note or a vault note was kept as; Undo
   * hands it to the generic undo. Null for a goal update, whose lines carry
   * their own, or when the record could not be written.
   */
  actionId: string | null;
  /** A goal update: the capture and the lines it was filed as, each with its own Undo. */
  goals: { captureId: string; entries: FiledEntry[] } | null;
  /** When it was undone, for a todo or a job note. */
  undoneAt: string | null;
  /** How many files went with it (plan #1714); absent when none did. */
  files?: number;
};

/** Where a part went, in the words the box shows and the landing draws. */
export function filedDestination(
  place: CapturePlace,
  detail: { role?: CaptureSortRole | null; entries?: readonly FiledEntry[] },
): CaptureDestination | null {
  const workspace = moduleById(CAPTURE_PLACE_MODULE[place]);
  if (!workspace) return null;
  const inside =
    place === 'todo'
      ? todoDayName('today')
      : place === 'goals'
        ? goalsPlaceName(detail.entries ?? [])
        : place === 'jobs' && detail.role
          ? roleName(detail.role)
          : place === 'vault'
            ? INBOX_FOLDER
            : null;
  return {
    module: workspace.id,
    href: workspace.home,
    name: inside ? `${workspace.label} · ${inside}` : workspace.label,
  };
}

/** What the box says once Enter has filed: "Filed in Todo · Today.", or a count for several. */
export function filedMessage(filed: readonly FiledCapture[]): string {
  if (filed.length === 0) return '';
  if (filed.length === 1) return `Filed in ${filed[0].where}.`;
  return `Filed in ${filed.length} places.`;
}
