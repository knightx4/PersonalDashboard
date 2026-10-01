import { describe, expect, it } from 'vitest';

import type { AgendaClients } from '@/lib/todo/agenda/clients';
import type { TaskLink } from '@/lib/todo/links/model';
import { resolveAnchors } from './anchors';

/**
 * A task made from a newsletter story shows the story and opens it
 * (plan #1369). Only the news client is asked; the rest would throw.
 */

function newsClients(rows: Record<string, unknown>[]): AgendaClients {
  const news = {
    from: () => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => ({
          data: rows.filter((row) => ids.includes(row.id as string)),
          error: null,
        }),
      }),
    }),
  };
  const refuse = async () => {
    throw new Error('not this one');
  };
  return {
    shopping: refuse,
    jobs: refuse,
    todo: refuse,
    goals: refuse,
    core: refuse,
    learn: refuse,
    vault: refuse,
    news: async () => news,
  } as unknown as AgendaClients;
}

const link = (taskId: string, storyId: string): TaskLink => ({
  taskId,
  relation: 'about',
  target: 'story',
  targetId: storyId,
});

describe('resolveAnchors for a story', () => {
  it('labels the task with the newsletter and headline and opens the story', async () => {
    const anchors = await resolveAnchors(
      [link('t1', 's1'), link('t2', 's2'), link('t3', 's3')],
      newsClients([
        { id: 's1', issue_id: 'i1', sender_name: 'Letters From Work', headline: 'Trams', unsaved_at: null },
        { id: 's2', issue_id: 'i2', sender_name: 'Money Stuff', headline: 'Bonds', unsaved_at: '2026-10-01T09:00:00Z' },
        { id: 's3', issue_id: null, sender_name: 'Gone Weekly', headline: 'Lost', unsaved_at: '2026-10-01T09:00:00Z' },
      ]),
    );

    expect(anchors.get('t1')).toEqual({
      label: 'Letters From Work · Trams',
      href: '/news/saved#story-s1',
    });
    expect(anchors.get('t2')).toEqual({ label: 'Money Stuff · Bonds', href: '/news/i/i2' });
    expect(anchors.get('t3')).toEqual({
      label: 'Gone Weekly · Lost',
      href: '/news',
      gone: 'no longer in News',
    });
  });
});
