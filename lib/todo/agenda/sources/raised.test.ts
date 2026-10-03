import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';

/**
 * Raises on the agenda (plan #1473): an open raise is on you, and answering
 * it hands the move to Dash, which takes it off the list.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn() }));

const { raisedItems } = await import('./raised');

function raise(id: string, extra: Partial<Parameters<typeof raisedItems>[0][number]> = {}) {
  return {
    id,
    title: 'Keep the old export?',
    ask: 'Say yes to keep it.',
    goal_id: null,
    status: 'open',
    created_at: '2026-10-01T09:00:00.000Z',
    ...extra,
  };
}

describe('raisedItems', () => {
  it('lists an open raise, linked to the Dash tab', () => {
    const [item] = raisedItems([raise('r1')]);
    expect(item).toMatchObject({
      key: 'raised:r1',
      source: 'raised',
      ref: 'public.raised_items:r1',
      title: 'Keep the old export?',
      detail: 'Say yes to keep it.',
      day: null,
      onYouSince: '2026-10-01T09:00:00.000Z',
      link: { href: '/dev/raised#raise-r1', label: 'Dash' },
      completable: false,
    });
    expect(parseRef(item.ref)).not.toBeNull();
  });

  it('links a goal flag to its goal', () => {
    expect(raisedItems([raise('r2', { goal_id: 'g1' })])[0].link).toEqual({ href: '/goals/g1', label: 'The goal' });
  });

  it('drops a raise once it is answered, closed or dismissed', () => {
    for (const status of ['answered', 'closed', 'dismissed']) {
      expect(raisedItems([raise('r1', { status })])).toEqual([]);
    }
  });
});
