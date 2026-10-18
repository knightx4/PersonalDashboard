'use client';

import { Card } from '@/components/ui/card';
import { TaskRow } from '@/components/todo/task-row';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * Tags on todo rows (plan #2340.2), as the agenda, All tasks and every Tasks
 * section draw them: a row with two tags, a long title with a long tag, and a
 * row with none, which draws nothing new. Then the hidden parts: the picker
 * open under a row, and the pointer's controls held (a chip's remove, the
 * plus chip alone on an untagged row).
 */

const TZ = 'Europe/London';

/** Tags used elsewhere on the list, as the picker reads them from the server. */
const USED = ['home', 'errands', 'car', 'council', 'garden'];

function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    body: null,
    status: 'open',
    dueOn: '2026-10-19',
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-10-09T08:00:00.000Z',
    position: null,
    parentId: null,
    tags: [],
    ...extra,
  };
}

export function TaskTagsSurface() {
  return (
    <Card padding="none" className="divide-y divide-border px-3">
      <TaskRow task={task('t1', 'Ring the garage about the MOT', { tags: ['car', 'now'] })} timezone={TZ} />
      <TaskRow
        task={task(
          't2',
          'Book the boiler service before the first cold week of the winter, and ask about the quote',
          { dueOn: null, tags: ['eventually', 'home', 'landlord-and-letting-agent-paperwork'] },
        )}
        timezone={TZ}
      />
      <TaskRow task={task('t3', 'Return the kettle')} timezone={TZ} />
    </Card>
  );
}

export function TaskTagsPickerSurface() {
  return (
    <Card padding="none" className="divide-y divide-border px-3">
      <TaskRow
        task={task('t1', 'Ring the garage about the MOT', { tags: ['car', 'now'] })}
        timezone={TZ}
        tagPreview={{ open: true, used: USED }}
      />
      <TaskRow task={task('t3', 'Return the kettle')} timezone={TZ} />
    </Card>
  );
}

export function TaskTagsHoverSurface() {
  return (
    <Card padding="none" className="divide-y divide-border px-3">
      <TaskRow
        task={task('t1', 'Ring the garage about the MOT', { tags: ['car', 'now'] })}
        timezone={TZ}
        tagPreview={{ revealed: true }}
      />
      <TaskRow task={task('t3', 'Return the kettle')} timezone={TZ} tagPreview={{ revealed: true }} />
    </Card>
  );
}
