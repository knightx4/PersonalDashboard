import { describe, expect, it } from 'vitest';
import { RAISED_COLUMNS, raisedQueueFrom, raisedRowFrom } from '@/lib/raised/load';

const raise = (over: {
  id: string;
  created_at: string;
  status?: string;
  module?: string | null;
}) => ({
  id: over.id,
  title: `raise ${over.id}`,
  detail: null,
  module: over.module === undefined ? 'dev' : over.module,
  source: 'the plan routine, step #199',
  status: over.status ?? 'open',
  created_at: over.created_at,
  answered_at: null,
});

describe('the raised queue', () => {
  it('puts open raises before closed ones, newest first in each half', () => {
    const queue = raisedQueueFrom(
      [
        raise({ id: 'old-open', created_at: '2026-09-01T09:00:00Z' }),
        raise({ id: 'answered', created_at: '2026-09-04T09:00:00Z', status: 'answered' }),
        raise({ id: 'new-open', created_at: '2026-09-03T09:00:00Z' }),
        raise({ id: 'dismissed', created_at: '2026-09-02T09:00:00Z', status: 'dismissed' }),
      ].map(raisedRowFrom),
    );

    expect(queue.rows.map((row) => row.id)).toEqual([
      'new-open',
      'old-open',
      'answered',
      'dismissed',
    ]);
    expect(queue.open.map((row) => row.id)).toEqual(['new-open', 'old-open']);
    expect(queue.closed.map((row) => row.id)).toEqual(['answered', 'dismissed']);
  });

  it('counts the open ones, which is what the sidebar and the bell read', () => {
    const queue = raisedQueueFrom(
      [
        raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' }),
        raise({ id: 'b', created_at: '2026-09-02T09:00:00Z' }),
        raise({ id: 'c', created_at: '2026-09-03T09:00:00Z', status: 'answered' }),
      ].map(raisedRowFrom),
    );

    expect(queue.openCount).toBe(2);
  });

  it('is empty rather than undefined when nothing has been raised', () => {
    const queue = raisedQueueFrom([]);

    expect(queue.rows).toEqual([]);
    expect(queue.open).toEqual([]);
    expect(queue.closed).toEqual([]);
    expect(queue.openCount).toBe(0);
  });
});

describe('the thread under a raise', () => {
  it('reads oldest first, whatever order the embedded select returned', () => {
    const row = raisedRowFrom({
      ...raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' }),
      comments: [
        { id: 'c2', author: 'claude', body: 'Then B it is.', created_at: '2026-09-02T09:00:00Z' },
        { id: 'c1', author: 'me', body: 'Do B.', created_at: '2026-09-01T18:00:00Z' },
      ],
    });

    expect(row.comments.map((comment) => comment.id)).toEqual(['c1', 'c2']);
    expect(row.comments.map((comment) => comment.author)).toEqual(['me', 'claude']);
  });

  it('is an empty list when nobody has said anything', () => {
    expect(raisedRowFrom(raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' })).comments).toEqual(
      [],
    );
  });
});

describe('a raise as the app reads it', () => {
  it('keeps a module the app knows and drops one it does not', () => {
    expect(raisedRowFrom(raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' })).module).toBe(
      'dev',
    );
    expect(
      raisedRowFrom(raise({ id: 'b', created_at: '2026-09-01T09:00:00Z', module: 'atlantis' }))
        .module,
    ).toBeNull();
    expect(
      raisedRowFrom(raise({ id: 'c', created_at: '2026-09-01T09:00:00Z', module: null })).module,
    ).toBeNull();
  });

  it('selects every column the row type needs', () => {
    const row = raisedRowFrom(raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' }));
    const selected = RAISED_COLUMNS.split(',').map((column) => column.trim());

    expect(selected).toContain('source');
    expect(selected).toContain('answered_at');
    expect(row.source).toBe('the plan routine, step #199');
    expect(row.answeredAt).toBeNull();
  });
});
