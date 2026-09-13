import { describe, expect, it } from 'vitest';
import { RAISED_COLUMNS, raisedQueueFrom, raisedRowFrom } from '@/lib/raised/load';

const raise = (over: {
  id: string;
  created_at: string;
  status?: string;
  module?: string | null;
  ask?: string | null;
  consequence?: unknown;
}) => ({
  id: over.id,
  title: `raise ${over.id}`,
  detail: null,
  ask: over.ask === undefined ? 'Run the gate on the merge to main? I would.' : over.ask,
  consequence: over.consequence ?? null,
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
      thread: [
        { id: 'c2', author: 'claude', body: 'Then B it is.', created_at: '2026-09-02T09:00:00Z' },
        { id: 'c1', author: 'me', body: 'Do B.', created_at: '2026-09-01T18:00:00Z' },
      ],
    });

    expect(row.thread.map((comment) => comment.id)).toEqual(['c1', 'c2']);
    expect(row.thread.map((comment) => comment.author)).toEqual(['me', 'claude']);
  });

  it('is an empty list when nobody has said anything', () => {
    expect(raisedRowFrom(raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' })).thread).toEqual([]);
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
    expect(selected).toContain('ask');
    expect(selected).toContain('consequence');
    expect(row.source).toBe('the plan routine, step #199');
    expect(row.answeredAt).toBeNull();
  });

  // The ask is what the page leads with, and the rows filed before there was
  // a column for it have none -- so it reads back as null rather than as an
  // empty string the view would render as a blank label.
  it('carries the ask, and is null on a raise filed without one', () => {
    expect(raisedRowFrom(raise({ id: 'a', created_at: '2026-09-01T09:00:00Z' })).ask).toBe(
      'Run the gate on the merge to main? I would.',
    );
    expect(
      raisedRowFrom(raise({ id: 'b', created_at: '2026-09-01T09:00:00Z', ask: null })).ask,
    ).toBeNull();
  });

  // What a yes does, read off the column with the sentence the page shows. The
  // raises filed before the column existed have none, and show none.
  it('carries what answering yes does, and is null on a raise that named none', () => {
    const named = raisedRowFrom(
      raise({
        id: 'a',
        created_at: '2026-09-01T09:00:00Z',
        consequence: { name: 'file_idea', text: 'Run the gate on the merge', module: null },
      }),
    );

    expect(named.consequence?.action.name).toBe('file_idea');
    expect(named.consequence?.said).toBe(
      'Files this on the ideas page, about Dev: Run the gate on the merge',
    );
    expect(
      raisedRowFrom(raise({ id: 'b', created_at: '2026-09-01T09:00:00Z' })).consequence,
    ).toBeNull();
  });
});
