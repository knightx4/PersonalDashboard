import { originItemId, type LinkedFile } from '@/lib/files/files';

/**
 * The Files list on a goal's page (plan #1860): every file the goal and its
 * steps link to, once each, the goal's own first, each saying who wrote it
 * and which step it was written for.
 *
 * Pure, so the wording is tested without a database. The links are read in
 * lib/goals/files-store.ts.
 */

export type GoalFileRow = {
  fileId: string;
  title: string;
  summary: string | null;
  meta: string;
  byDash: boolean;
};

/** Each step in the trees by id, at any depth, for naming the step a file came from. */
export function stepTitlesIn(
  trees: readonly (readonly { id: string; title: string; children: readonly unknown[] }[])[],
): Map<string, string> {
  type Node = { id: string; title: string; children: readonly unknown[] };
  const titles = new Map<string, string>();
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      titles.set(node.id, node.title);
      walk(node.children as readonly Node[]);
    }
  };
  for (const tree of trees) walk(tree);
  return titles;
}

/**
 * "Written by Dash for “List the firms hiring” · version 2". The step is the
 * one the file was written for (its origin), or else the first step that
 * links it; a file written for the goal itself names no step.
 */
export function goalFileMeta(
  file: Pick<LinkedFile, 'madeBy' | 'version'>,
  stepTitle: string | null,
): string {
  const who = file.madeBy === 'you' ? 'Written by you' : 'Written by Dash';
  const step = stepTitle ? ` for “${stepTitle}”` : '';
  const version = file.version && file.version > 1 ? ` · version ${file.version}` : '';
  return `${who}${step}${version}`;
}

export function goalFileRows(
  goalId: string,
  filesOf: Readonly<Record<string, readonly LinkedFile[]>>,
  stepTitles: ReadonlyMap<string, string>,
): GoalFileRow[] {
  const linkedFrom = new Map<string, string>();
  const order: LinkedFile[] = [];
  const seen = new Set<string>();
  const add = (itemId: string, files: readonly LinkedFile[] | undefined) => {
    for (const file of files ?? []) {
      if (itemId !== goalId && !linkedFrom.has(file.fileId)) linkedFrom.set(file.fileId, itemId);
      if (seen.has(file.fileId)) continue;
      seen.add(file.fileId);
      order.push(file);
    }
  };
  add(goalId, filesOf[goalId]);
  for (const [itemId, files] of Object.entries(filesOf)) if (itemId !== goalId) add(itemId, files);

  return order.map((file) => {
    const origin = originItemId(file.origin ?? null);
    const stepId =
      origin === goalId
        ? undefined
        : origin && stepTitles.has(origin)
          ? origin
          : linkedFrom.get(file.fileId);
    const stepTitle = stepId ? (stepTitles.get(stepId) ?? null) : null;
    return {
      fileId: file.fileId,
      title: file.title,
      summary: file.summary,
      meta: goalFileMeta(file, stepTitle),
      byDash: file.madeBy !== 'you',
    };
  });
}
