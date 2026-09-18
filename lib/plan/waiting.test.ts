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

  it('lists a setup job with its detail as what you have to do', () => {
    // #599: the title is the one-line summary, the detail is the instructions.
    const [row] = rows([
      item({
        id: 'h',
        kind: 'setup',
        title: 'Make a Vercel token',
        detail: 'Vercel > Account Settings > Tokens > Create, scope it to this project.',
      }),
    ]);

    expect(row.health).toBe('setup');
    expect(row.title).toBe('Make a Vercel token');
    expect(row.ask).toBe('Vercel > Account Settings > Tokens > Create, scope it to this project.');
  });

  it('drops a setup job once it is done', () => {
    expect(rows([item({ id: 'i', kind: 'setup', status: 'done' })])).toEqual([]);
    expect(rows([item({ id: 'j', kind: 'setup', status: 'dropped' })])).toEqual([]);
  });

  it('puts a setup job under what has stopped and above what is only to read', () => {
    const found = rows([
      item({ id: 'k', status: 'proposed' }),
      item({ id: 'l', kind: 'decision' }),
      item({ id: 'm', kind: 'setup' }),
      item({ id: 'n', status: 'blocked', blockAsk: 'Say which of the two names to use.' }),
    ]);

    expect(found.map((row) => row.health)).toEqual(['blocked', 'setup', 'unanswered', 'proposed']);
  });

  it('leaves out a feature that is only waiting because a step beneath it is', () => {
    // #635 was a not-started feature whose one open step was blocked, and both
    // of them were on this list. `healthOf` reports a feature as blocked when
    // nothing beneath it can move, which is right on the plan page, where the
    // step is on the next line. Here it put up a row with no ask on it and
    // nothing to press, beside the step that had both.
    const found = rows([
      item({ id: 'o', title: 'The feature' }),
      item({
        id: 'p',
        parentId: 'o',
        title: 'The step',
        status: 'blocked',
        blockAsk: 'Say whether the mark is enough.',
      }),
    ]);

    expect(found.map((row) => row.title)).toEqual(['The step']);
    expect(found[0].ask).toBe('Say whether the mark is enough.');
  });

  it('still lists a question beneath a feature that is finished', () => {
    const found = rows([
      item({ id: 'q', title: 'Shipped', status: 'done' }),
      item({ id: 'r', parentId: 'q', title: 'One thing left', kind: 'decision' }),
    ]);

    expect(found.map((row) => row.title)).toEqual(['One thing left']);
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
