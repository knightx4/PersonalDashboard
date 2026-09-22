import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/lib/plan/load';
import { buildPlanTree } from '@/lib/plan/tree';
import { isJobForYou, latestBlockNote, waitingGroups, waitingOnYou } from '@/lib/plan/waiting';
import { raisedQueueFrom, type RaisedRow } from '@/lib/raised/load';

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

function raise(over: Partial<RaisedRow> & { id: string }): RaisedRow {
  return {
    title: `Raise ${over.id}`,
    detail: null,
    ask: 'Say whether this is worth doing.',
    consequence: null,
    outcome: null,
    module: 'dev',
    source: 'plan #600',
    status: 'open',
    createdAt: '2026-02-01T00:00:00Z',
    answeredAt: null,
    thread: [],
    ...over,
  };
}

function groups(items: PlanItem[], raises: RaisedRow[] = []) {
  return waitingGroups(buildPlanTree({ items, dependencies: [] }), raisedQueueFrom(raises));
}

/** The numbers and raise titles in each group, by heading. */
function laidOut(items: PlanItem[], raises: RaisedRow[] = []) {
  return Object.fromEntries(
    groups(items, raises).map((group) => [
      group.title,
      group.entries.map((entry) =>
        entry.kind === 'plan' ? `#${entry.row.number}` : entry.raise.title,
      ),
    ]),
  );
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

  // Dash draws the thread on the row, so the row has to arrive carrying it.
  it('carries the step thread through to the row', () => {
    const [row] = rows([
      item({
        id: 'b2',
        status: 'blocked',
        blockAsk: 'A Resend API key.',
        thread: [
          {
            id: 'c1',
            author: 'me',
            body: 'Ordered, it should be here Friday.',
            createdAt: '2026-09-18T09:00:00.000Z',
          },
        ],
      }),
    ]);

    expect(row.thread.map((comment) => comment.body)).toEqual([
      'Ordered, it should be here Friday.',
    ]);
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

describe('the row a page has to finish', () => {
  it('carries the question and the answer already recorded', () => {
    const [row] = rows([
      item({
        id: 'a',
        kind: 'decision',
        detail: 'Which way?\nA — one way. B — the other.',
        resolution: 'B, but only for the dev module.',
      }),
    ]);

    expect(row.health).toBe('unanswered');
    expect(row.detail).toBe('Which way?\nA — one way. B — the other.');
    expect(row.resolution).toBe('B, but only for the dev module.');
  });

  it('counts the proposed steps a proposal would approve with it', () => {
    // `approvePlanItem` approves the row and everything proposed beneath it,
    // so the button has to be able to say how many that is. The step already
    // agreed to is not one of them. Each proposal is still listed in its own
    // right -- every row here answers for itself -- so the count is what
    // pressing that row's approve takes with it.
    const found = rows([
      item({ id: 'a', status: 'proposed' }),
      item({ id: 'b', parentId: 'a', status: 'proposed' }),
      item({ id: 'c', parentId: 'b', status: 'proposed' }),
      item({ id: 'd', parentId: 'a', status: 'not_started' }),
    ]);

    expect(found.map((row) => row.proposedBeneath)).toEqual([2, 1, 0]);
  });

  it('counts nothing beneath a step with no proposals under it', () => {
    const [row] = rows([item({ id: 'a', status: 'blocked', blockAsk: 'A token.' })]);
    expect(row.proposedBeneath).toBe(0);
    expect(row.resolution).toBeNull();
  });
});

describe('waitingGroups', () => {
  it('sorts a stopped step, a question and a proposal into the three groups', () => {
    expect(
      laidOut([
        item({ id: 'a', number: 1, status: 'proposed' }),
        item({ id: 'b', number: 2, kind: 'decision' }),
        item({ id: 'c', number: 3, status: 'blocked', blockAsk: 'A token, scoped to this repo.' }),
        item({ id: 'd', number: 4, kind: 'setup' }),
      ]),
    ).toEqual({
      'Your actions': ['#3', '#4'],
      'Questions for you': ['#2'],
      'To approve': ['#1'],
    });
  });

  it('puts a step blocked on your read or your say-so under Questions', () => {
    // Note d0ae7105: Your actions is only for what you clearly have to do.
    expect(
      laidOut([
        item({
          id: 'a',
          number: 1,
          status: 'blocked',
          blockAsk:
            'Read the new section of the privacy page and say whether it can go to main as written.',
        }),
        item({ id: 'b', number: 2, status: 'blocked', blockAsk: 'Should the export keep the nesting?' }),
        item({ id: 'c', number: 3, status: 'blocked', blockAsk: 'Set GITHUB_TOKEN in Vercel.' }),
        item({ id: 'd', number: 4, status: 'blocked', blockAsk: null }),
      ]),
    ).toEqual({
      'Your actions': ['#3'],
      'Questions for you': ['#1', '#2', '#4'],
      'To approve': [],
    });
  });

  it('reads a job from its wording and a question from anything short of one', () => {
    expect(isJobForYou('Add the Mailgun API key to the Vercel project.')).toBe(true);
    expect(isJobForYou('A token, scoped to this repo.')).toBe(true);
    expect(isJobForYou('Allow ocw.mit.edu in the session network policy.')).toBe(true);
    expect(isJobForYou('Which of the two layouts do you want?')).toBe(false);
    expect(isJobForYou('Answer twenty applied cases and say whether a second turn is worth it.')).toBe(false);
    expect(isJobForYou('The wording of the empty state.')).toBe(false);
    expect(isJobForYou(null)).toBe(false);
  });

  it('keeps the three in order and returns the empty ones too', () => {
    expect(groups([]).map((group) => group.key)).toEqual(['actions', 'questions', 'approve']);
    expect(groups([]).every((group) => group.entries.length === 0)).toBe(true);
  });

  it('puts a raise that named an action under To approve and the rest under Questions', () => {
    // #622 a: the split is by whether the request named something a yes runs.
    expect(
      laidOut(
        [],
        [
          raise({ id: 'r1', title: 'Should the export keep the nesting?' }),
          raise({
            id: 'r2',
            title: 'File this as an idea',
            consequence: {
              action: {
                name: 'file_idea',
                text: 'A quieter night run',
                module: 'dev',
                field: null,
                detail: null,
                kind: null,
              },
              said: 'Files this on the ideas page, about Dev: A quieter night run',
            },
          }),
        ],
      ),
    ).toEqual({
      'Your actions': [],
      'Questions for you': ['Should the export keep the nesting?'],
      'To approve': ['File this as an idea'],
    });
  });

  it('leaves out a raise that is not open', () => {
    expect(
      laidOut([], [raise({ id: 'r3', status: 'closed', outcome: 'Filed as #700.' })]),
    ).toEqual({ 'Your actions': [], 'Questions for you': [], 'To approve': [] });
  });

  it('puts the plan rows above the raises in the group they share', () => {
    const found = laidOut(
      [item({ id: 'a', number: 9, kind: 'decision' })],
      [raise({ id: 'r4', title: 'A question with no action on it' })],
    );

    expect(found['Questions for you']).toEqual(['#9', 'A question with no action on it']);
  });
});
