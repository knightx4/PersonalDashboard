'use client';

import { Card } from '@/components/ui/card';
import { TaskRow } from '@/components/todo/task-row';
import type { TaskFile } from '@/components/attachments/task-files';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * Todos holding files (plan #1714), as /todo and /todo/all draw them: a row
 * whose paperclip has opened its photo and PDF (the task the archive was
 * sent to), a row with one file still closed, and a row with none beside
 * them. The photo is drawn inline, since the gallery cannot sign a link.
 */

/** A photo of a letter, small enough to sit in the fixture. */
const LETTER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320">' +
    '<rect width="240" height="320" fill="#d9d4c7"/>' + // ui-ok: the paper and ink of a photographed letter, drawn as the fixture's picture
    '<rect x="28" y="24" width="184" height="272" rx="2" fill="#fbfaf6" transform="rotate(-3 120 160)"/>' + // ui-ok: the paper and ink of a photographed letter, drawn as the fixture's picture
    '<g fill="#9c978b" transform="rotate(-3 120 160)">' + // ui-ok: the paper and ink of a photographed letter, drawn as the fixture's picture
    '<rect x="48" y="52" width="70" height="8"/><rect x="48" y="90" width="144" height="5"/>' +
    '<rect x="48" y="104" width="130" height="5"/><rect x="48" y="118" width="140" height="5"/>' +
    '<rect x="48" y="132" width="96" height="5"/><rect x="48" y="160" width="144" height="5"/>' +
    '<rect x="48" y="174" width="120" height="5"/><rect x="48" y="240" width="60" height="6"/></g></svg>',
)}`;

function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    body: null,
    status: 'open',
    dueOn: '2026-10-09',
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-10-09T08:00:00.000Z',
    position: null,
    parentId: null,
    ...extra,
  };
}

const LETTER_FILES: TaskFile[] = [
  { id: 'f1', name: 'IMG_4471.jpg', contentType: 'image/jpeg', size: 2_310_000, href: LETTER },
  {
    id: 'f2',
    name: 'Council tax reminder and the statement of account for the year ending March 2027.pdf',
    contentType: 'application/pdf',
    size: 184_000,
    href: '#',
  },
];

const ONE_FILE: TaskFile[] = [
  { id: 'f3', name: 'boiler-quote.pdf', contentType: 'application/pdf', size: 96_000, href: '#' },
];

const nothing: TaskFile[] = [];

export function TaskFilesSurface() {
  return (
    <Card padding="none" className="divide-y divide-border px-3">
      <TaskRow
        task={task('t1', 'Reply to the council about the letter by Friday', { dueOn: '2026-10-10' })}
        timezone="Europe/London"
        files={LETTER_FILES}
        filesOpen
      />
      <TaskRow
        task={task('t2', 'Book the boiler service before the first cold week of the winter, and ask about the quote')}
        timezone="Europe/London"
        files={ONE_FILE}
      />
      <TaskRow task={task('t3', 'Return the kettle')} timezone="Europe/London" files={nothing} />
    </Card>
  );
}
