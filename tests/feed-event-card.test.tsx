/**
 * A subscribed appointment, opened (plan #1374).
 *
 * The meeting reads and nothing on the card changes it; what the card adds is
 * the tasks about it: a button that writes one, and the open ones already
 * linked to this date of it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedEventCard } from '@/components/todo/feed-event-card';
import type { Task } from '@/lib/todo/tasks/model';

const TASK: Task = {
  id: 't1',
  title: 'Pull the Q4 numbers together',
  body: null,
  status: 'open',
  dueOn: '2026-09-09',
  dueAt: null,
  pinned: false,
  snoozedUntil: null,
  completedAt: null,
  createdAt: '2026-09-02T08:00:00.000Z',
  position: null,
  parentId: null,
};

function render(tasks: Task[]) {
  return renderToStaticMarkup(
    <FeedEventCard
      detail={{
        feedName: 'Work',
        event: {
          id: '00000000-0000-4000-8000-000000001374',
          feedId: '00000000-0000-4000-8000-000000000f01',
          title: 'Quarterly planning',
          body: null,
          location: null,
          startsOn: null,
          endsOn: null,
          startsAt: '2026-09-10T09:00:00.000Z',
          endsAt: '2026-09-10T10:30:00.000Z',
          createdAt: '2026-09-01T08:00:00.000Z',
        },
      }}
      view="month"
      anchor="2026-09-10"
      timezone="Europe/London"
      tasks={tasks}
    />,
  );
}

describe('FeedEventCard', () => {
  it('offers a task about the meeting and lists the ones already about it', () => {
    const html = render([TASK]);
    expect(html).toContain('Add a task about this');
    expect(html).toContain('Tasks about this');
    expect(html).toContain('Pull the Q4 numbers together');
  });

  it('says so when nothing is about it yet', () => {
    expect(render([])).toContain('Nothing outstanding.');
  });

  it('still offers no way to change the meeting itself', () => {
    const html = render([]);
    expect(html).toContain('From Work.');
    expect(html).not.toMatch(/>(Edit|Delete|Save)</);
    expect(html).not.toContain('name="startDay"');
  });
});
