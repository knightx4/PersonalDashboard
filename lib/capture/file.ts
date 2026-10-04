/**
 * Filing what the one capture box was given (plan #1581): each part through
 * the writer its workspace already has, and each todo or job note recorded in
 * core.dash_actions with surface 'capture' so Undo, in the box and on Home,
 * takes it back by the generic rule. A goal update goes through Goals' own
 * filing, which records each line it files itself (plan #1569).
 *
 * The writers are passed in, so this is tested without a session; the server
 * action in app/capture-actions.ts binds them to the signed-in person.
 */

import type { DashActionEntry } from '@/lib/core/dash-actions';
import { capturePartLabel, filedDestination, type FiledCapture } from '@/lib/capture/place';
import { roleName, type CapturePart } from '@/lib/capture/sort';
import type { FiledEntry } from '@/lib/goals/capture';

/** What each writer reports: the row it wrote, or the sentence saying why not. */
export type CaptureWriters = {
  /** addTask: a todo for today. */
  todo: (text: string) => Promise<{ id?: string; error?: string }>;
  /** fileGoalCapture: the sentence filed against their goals. */
  goals: (text: string) => Promise<{ captureId?: string; filed?: FiledEntry[]; error?: string }>;
  /** The add_role_note write, on a role of theirs. */
  jobs: (
    roleId: string,
    text: string,
  ) => Promise<{ ok: true; subjectRef: string } | { ok: false; error: string }>;
  /** recordDashAction, bound to the person. */
  record: (entry: DashActionEntry) => Promise<string | null>;
};

export type CaptureFiled = {
  filed: FiledCapture[];
  /** Why a part was not filed, one sentence each. */
  errors: string[];
};

/** The first words of what was filed, for the record's sentence. */
function quoted(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= 80 ? flat : `${flat.slice(0, 79).trimEnd()}…`;
}

/** File each part in turn. A part that fails is said in `errors` and the rest still go. */
export async function fileCaptureParts(
  parts: readonly CapturePart[],
  writers: CaptureWriters,
): Promise<CaptureFiled> {
  const filed: FiledCapture[] = [];
  const errors: string[] = [];

  for (const part of parts) {
    const text = part.text.trim();
    if (!text) continue;

    if (part.place === 'todo') {
      const result = await writers.todo(text);
      if (result.error || !result.id) {
        errors.push(result.error ?? 'The todo could not be added.');
        continue;
      }
      const where = filedDestination('todo', {});
      const actionId = await writers.record({
        surface: 'capture',
        kind: 'add_todo',
        subjectRef: `todo.tasks:${result.id}`,
        op: 'insert',
        summary: `Dash added the todo "${quoted(text)}" from capture.`,
      });
      filed.push({
        place: 'todo',
        text,
        where: where?.name ?? 'Todo',
        href: where?.href ?? '/todo',
        actionId,
        goals: null,
        undoneAt: null,
      });
      continue;
    }

    if (part.place === 'goals') {
      const result = await writers.goals(text);
      if (result.error || !result.captureId) {
        errors.push(result.error ?? 'Nothing was filed against your goals.');
        continue;
      }
      const entries = result.filed ?? [];
      const where = filedDestination('goals', { entries });
      filed.push({
        place: 'goals',
        text,
        where: where?.name ?? 'Goals',
        href: where?.href ?? '/goals',
        actionId: null,
        goals: { captureId: result.captureId, entries },
        undoneAt: null,
      });
      continue;
    }

    if (part.place === 'jobs') {
      if (!part.role) {
        errors.push('Dash could not tell which job this is about. Name the company and try again.');
        continue;
      }
      const result = await writers.jobs(part.role.id, text);
      if (!result.ok) {
        errors.push(result.error);
        continue;
      }
      const where = filedDestination('jobs', { role: part.role });
      const actionId = await writers.record({
        surface: 'capture',
        kind: 'add_role_note',
        subjectRef: result.subjectRef,
        op: 'insert',
        summary: `Dash added a note to the role ${roleName(part.role)} from capture.`,
      });
      filed.push({
        place: 'jobs',
        text,
        where: where?.name ?? 'Job search',
        href: where?.href ?? '/jobs',
        actionId,
        goals: null,
        undoneAt: null,
      });
      continue;
    }

    // A place with no writer yet (the vault, until plan #1582) is never
    // offered, so a part for it only arrives from a stale box.
    errors.push(`${capturePartLabel(part)} is not something capture can do yet.`);
  }

  return { filed, errors };
}
