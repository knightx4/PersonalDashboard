import 'server-only';

import type { TaskFile } from '@/components/attachments/task-files';
import { listAttachments } from '@/lib/attachments/store';
import { createCoreClient } from '@/lib/core/auth/server';

/**
 * The files each task on a page holds (plan #1714), in one query, keyed by
 * the task's id. A task with none is absent. A failed read costs the
 * paperclips and nothing else, so the list still draws.
 */
export async function loadTaskFiles(taskIds: readonly string[]): Promise<Map<string, TaskFile[]>> {
  const byTask = new Map<string, TaskFile[]>();
  if (taskIds.length === 0) return byTask;
  try {
    const held = await listAttachments(
      await createCoreClient(),
      taskIds.map((id) => `todo.tasks:${id}`),
    );
    for (const [ref, files] of held) {
      byTask.set(
        ref.slice('todo.tasks:'.length),
        files.map(({ id, name, contentType, size, href }) => ({ id, name, contentType, size, href })),
      );
    }
  } catch (error) {
    console.error('todo: reading the files failed', error);
  }
  return byTask;
}
