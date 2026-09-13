import { describe, expect, it } from 'vitest';
import {
  MAX_READY,
  oneLine,
  whatHappened,
  whatIsReady,
  withSuggestions,
  type DigestPointer,
} from '@/lib/digest/build';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { PlanData, PlanItem } from '@/lib/plan/load';

const SINCE = '2026-03-02T00:00:00Z';

let counter = 0;

function step(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'dev',
    parentId: null,
    title: `Step ${over.id}`,
    detail: null,
    acceptance: null,
    status: 'done',
    kind: 'build',
    fog: null,
    fogDismissedAt: null,
    dismissedAt: null,
    resolution: null,
    thread: [],
    comment: null,
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter * 10,
    startedAt: null,
    completedAt: '2026-03-02T09:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function note(over: Partial<FeedbackRow> & { id: string }): FeedbackRow {
  return {
    kind: 'bug',
    body: `Note ${over.id}`,
    pagePath: null,
    status: 'done',
    priority: 2,
    resolutionNote: null,
    commitSha: null,
    createdAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-03-02T09:00:00Z',
    ...over,
  };
}

function plan(items: PlanItem[]): PlanData {
  return { items, dependencies: [] };
}

describe('oneLine', () => {
  it('flattens the whitespace a bug report was typed with', () => {
    expect(oneLine('  two\n\nlines  ')).toBe('two lines');
  });

  it('cuts at a word and marks that it cut', () => {
    expect(oneLine('alpha bravo charlie delta', 16)).toBe('alpha bravo…');
  });
});

describe('whatHappened', () => {
  it('carries the commit of a step that shipped in the window', () => {
    const events = whatHappened({
      plan: plan([step({ id: 'a', number: 42, commitSha: 'abc1234def', title: 'The panel' })]),
      notes: [],
      since: SINCE,
    });

    expect(events).toEqual([
      { kind: 'step', title: 'The panel', ref: '#42', commit: 'abc1234', note: null, at: '2026-03-02T09:00:00Z' },
    ]);
  });

  it('leaves out what closed before the window opened', () => {
    const events = whatHappened({
      plan: plan([step({ id: 'a', completedAt: '2026-03-01T09:00:00Z' })]),
      notes: [note({ id: 'n', completedAt: '2026-03-01T23:59:00Z' })],
      since: SINCE,
    });

    expect(events).toEqual([]);
  });

  it('reports a note by what was done about it', () => {
    const [event] = whatHappened({
      plan: plan([]),
      notes: [note({ id: 'n', body: 'The total was wrong', resolutionNote: 'Rounded once.' })],
      since: SINCE,
    });

    expect(event).toMatchObject({ kind: 'note', title: 'The total was wrong', ref: null, note: 'Rounded once.' });
  });

  it('reports an answered question with the answer, and no commit', () => {
    const [event] = whatHappened({
      plan: plan([
        step({
          id: 'd',
          number: 7,
          kind: 'decision',
          title: 'Which shape for the export?',
          resolution: 'b — JSON',
        }),
      ]),
      notes: [],
      since: SINCE,
    });

    expect(event).toMatchObject({ kind: 'decision', ref: '#7', commit: null, note: 'b — JSON' });
  });

  it('leaves out a dropped step and a declined note, which shipped nothing', () => {
    const events = whatHappened({
      plan: plan([step({ id: 'a', status: 'dropped' })]),
      notes: [note({ id: 'n', status: 'declined' })],
      since: SINCE,
    });

    expect(events).toEqual([]);
  });

  it('puts the newest first', () => {
    const events = whatHappened({
      plan: plan([
        step({ id: 'early', title: 'Early', completedAt: '2026-03-02T08:00:00Z' }),
        step({ id: 'late', title: 'Late', completedAt: '2026-03-02T20:00:00Z' }),
      ]),
      notes: [],
      since: SINCE,
    });

    expect(events.map((event) => event.title)).toEqual(['Late', 'Early']);
  });
});

describe('whatIsReady', () => {
  it('puts a question waiting on the person above the steps', () => {
    const pointers = whatIsReady(
      plan([
        step({ id: 'a', number: 1, status: 'not_started', completedAt: null, title: 'Build it' }),
        step({
          id: 'q',
          number: 2,
          kind: 'decision',
          status: 'not_started',
          completedAt: null,
          title: 'Which shape?',
        }),
      ]),
    );

    expect(pointers).toEqual([
      { kind: 'decision', title: 'Which shape?', ref: '#2', detail: null },
      { kind: 'ready', title: 'Build it', ref: '#1', detail: null },
    ]);
  });

  it('leaves out what is not ready: proposals, work underway, and what waits on another step', () => {
    const parent = step({ id: 'p', status: 'proposed', completedAt: null });
    const items = [
      parent,
      step({ id: 'child', status: 'not_started', completedAt: null, parentId: 'p' }),
      step({ id: 'underway', status: 'in_progress', completedAt: null }),
      step({ id: 'waiting', status: 'not_started', completedAt: null }),
      step({ id: 'open', status: 'not_started', completedAt: null }),
    ];
    const waiting = items[3];
    const open = items[4];

    const pointers = whatIsReady({
      items,
      dependencies: [{ id: 'd1', itemId: waiting.id, dependsOnId: open.id }],
    });

    expect(pointers.map((pointer) => pointer.ref)).toEqual([`#${open.number}`]);
  });

  it('caps the ready steps so the list stays a list', () => {
    const items = Array.from({ length: MAX_READY + 3 }, (_, index) =>
      step({ id: `s${index}`, status: 'not_started', completedAt: null }),
    );

    expect(whatIsReady(plan(items))).toHaveLength(MAX_READY);
  });
});

describe('withSuggestions', () => {
  const ready: DigestPointer[] = [{ kind: 'ready', title: 'Build it', ref: '#1', detail: null }];

  it('adds what the model noticed after what was computed', () => {
    const pointers = withSuggestions(ready, [
      { title: 'Two questions hold up #338', detail: 'Answer one and four steps open up.' },
    ]);

    expect(pointers[1]).toEqual({
      kind: 'suggestion',
      title: 'Two questions hold up #338',
      ref: null,
      detail: 'Answer one and four steps open up.',
    });
  });

  it('drops an empty suggestion rather than rendering a blank row', () => {
    expect(withSuggestions(ready, [{ title: '   ', detail: null }])).toEqual(ready);
  });
});
