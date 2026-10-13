import { coreActions } from '@/lib/core/agent-actions';
import { devActions } from '@/lib/dev/agent-actions';
import { goalsActions } from '@/lib/goals/agent-actions';
import { shoppingActions } from '@/lib/inventory/agent-actions';
import { jobsActions } from '@/lib/jobs/agent-actions';
import { learnActions } from '@/lib/learn/agent-actions';
import { newsActions } from '@/lib/news/agent-actions';
import { todoActions } from '@/lib/todo/agent-actions';
import { vaultActions } from '@/lib/vault/agent-actions';
import type { ModuleId } from '@/lib/modules';
import type { ActionEntry, ModuleActions } from './types';

/**
 * Every module's server actions, gathered (lib/agent-actions/types.ts).
 * lib/agent-actions/catalogue.test.ts holds it to the files under app/, so a
 * new action cannot land unlisted, and the `agent-action-gaps` counter in
 * scripts/spec-counts.ts counts what no tool does yet.
 *
 * A module with server actions adds its `agent-actions.ts` here. That is the
 * only edit outside the module.
 */
export const WORKSPACE_ACTIONS: readonly (readonly [ModuleId | null, ModuleActions])[] = [
  ['shopping', shoppingActions],
  ['jobs', jobsActions],
  ['todo', todoActions],
  ['vault', vaultActions],
  ['learn', learnActions],
  ['news', newsActions],
  ['goals', goalsActions],
  ['dev', devActions],
  // Signing in, the account, Ask, Home and the threads belong to no one workspace.
  [null, coreActions],
];

export type CataloguedAction = {
  /** The file it is exported from, from the repository root. */
  file: string;
  /** The exported function's name. */
  name: string;
  workspace: ModuleId | null;
  entry: ActionEntry;
};

/** Every catalogued action, in the order the modules list them. */
export const AGENT_ACTIONS: readonly CataloguedAction[] = WORKSPACE_ACTIONS.flatMap(
  ([workspace, files]) =>
    Object.entries(files).flatMap(([file, actions]) =>
      Object.entries(actions).map(([name, entry]) => ({ file, name, workspace, entry })),
    ),
);

/** `app/todo/actions.ts#addTask`, the key an action is known by in messages and counts. */
export function actionKey(action: { file: string; name: string }): string {
  return `${action.file}#${action.name}`;
}

/** The tools an entry names, or none. */
export function entryTools(entry: ActionEntry): readonly string[] {
  if (!('tool' in entry)) return [];
  return typeof entry.tool === 'string' ? [entry.tool] : entry.tool;
}

/** The actions an agent should be able to do and has no tool for: what `agent-action-gaps` counts. */
export function actionGaps(actions: readonly CataloguedAction[] = AGENT_ACTIONS): string[] {
  return actions.filter((a) => 'gap' in a.entry).map(actionKey);
}
