import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { latestBlockNote, waitingOnYou } from '@/lib/plan/waiting';

let counter = 0;

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: null,
    createdAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    updatedAt: `2026-01-01T00:00:${String(counter).padStart(2, '0')}Z`,
    ...over,
  };
}

function rows(items: PlanItem[]) {
  return waitingOnYou(buildPlanTree({ items, dependencies: [] }));
}

describe('waitingOnYou', () => {
  it('shows the ask a block wrote, not the history under it', () => {
    const [row] = rows([
      item({
        id: 'a',
        status: 'blocked',
        blockAsk: 'Put a GitHub token with Contents: Read in the Vercel environment.',
        comment:
          'Blocked 2026-09-15: the fire response has an id but nothing to ask about it.\n\n' +
          'Blocked 2026-09-16: the deploy key cannot read the REST API, so it has to be a token.',
      }),
    ]);

    expect(row.health).toBe('blocked');
    expect(row.ask).toBe('Put a GitHub token with Contents: Read in the Vercel environment.');
  });

  it('falls back to the last dated paragraph on a step blocked before the ask existed', () => {
    const [row] = rows([
      item({
        id: 'b',
        status: 'blocked',
        comment: 'Blocked 2026-09-15: the first request.\n\nBlocked 2026-09-16: what still stands.',
      }),
    ]);

    expect(row.ask).toBe('what still stands.');
  });

  it('reads a decision as its question and a proposal as its title alone', () => {
    const found = rows([
      item({ id: 'c', kind: 'decision', detail: 'A — one way. B — the other.' }),
      item({ id: 'd', status: 'proposed' }),
    ]);

    expect(found.map((row) => row.health)).toEqual(['unanswered', 'proposed']);
    expect(found[0].ask).toBe('A — one way. B — the other.');
    expect(found[1].ask).toBeNull();
  });

  it('puts what has stopped above what is only waiting to be read', () => {
    const found = rows([
      item({ id: 'e', status: 'proposed' }),
      item({ id: 'f', kind: 'decision' }),
      item({ id: 'g', status: 'blocked', blockAsk: 'Say which of the two names to use.' }),
    ]);

    expect(found.map((row) => row.health)).toEqual(['blocked', 'unanswered', 'proposed']);
  });
});

describe('latestBlockNote', () => {
  it('drops the date stamp and keeps the request', () => {
    expect(latestBlockNote('Blocked 2026-09-16: a token, scoped to this repo.')).toBe(
      'a token, scoped to this repo.',
    );
  });

  it('is null when nothing in the comment is a block', () => {
    expect(latestBlockNote('Done 2026-09-16: shipped.')).toBeNull();
    expect(latestBlockNote(null)).toBeNull();
  });
});
