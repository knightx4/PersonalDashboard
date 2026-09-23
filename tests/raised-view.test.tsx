/**
 * The raised page, rendered.
 *
 * Two claims about markup that no test on the loader can see: a raise that
 * named what a yes does must show it under the ask and offer yes and no, and a
 * raise filed before there was a column for it must read exactly as it did —
 * the story and the answer box, no empty label and no buttons for an action
 * that does not exist.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { raisedQueueFrom, raisedRowFrom, type RaisedRow } from '@/lib/raised/load';
import type { WaitingGroup, WaitingGroupKey, WaitingRow } from '@/lib/plan/waiting';

// The server actions pull in the session client, which has no business in a
// render test; the view only needs them to exist to hand to its forms.
vi.mock('@/app/dev/raised/actions', () => {
  const noop = async () => ({});
  return { closeRaise: noop, decideRaise: noop, dismissRaise: noop, reopenRaise: noop };
});

// The plan's own actions, for the same reason: the setup row's Done button, the
// question's answering box and both approve buttons drive them, and the render
// only needs them to be functions.
vi.mock('@/app/dev/plan/actions', () => ({
  setPlanItemStatus: async () => ({}),
  answerBlockedStep: async () => ({}),
  answerPlanDecision: async () => ({}),
  approvePlanItem: async () => ({}),
  approveProposals: async () => ({}),
}));

const { RaisedView } = await import('@/app/dev/raised/raised-view');

function raise(over: Record<string, unknown> = {}): RaisedRow {
  return raisedRowFrom({
    id: 'r1',
    title: 'Two sessions were sent at plan step #342 at the same time',
    detail: 'Both runs claimed it within the same minute.',
    ask: 'Should Send to Claude refuse a step whose feature is already being worked?',
    consequence: null,
    outcome: null,
    module: 'dev',
    source: 'plan #342',
    status: 'open',
    created_at: '2026-09-13T04:57:00.000Z',
    answered_at: null,
    ...over,
  });
}

/**
 * The three groups as the page is handed them, built here rather than derived.
 *
 * Which group a row belongs in is `waitingGroups`' job and is tested against
 * the plan tree in lib/plan/waiting.test.ts. These tests are about the markup,
 * so the placement is stated outright: plan rows by what finishes them, raises
 * by whether they named an action, and all three groups present whether or not
 * they hold anything, which is what the real function returns.
 */
const TITLE: Record<WaitingGroupKey, string> = {
  actions: 'Your actions',
  questions: 'Questions for you',
  approve: 'To approve',
};

const OF_HEALTH: Record<WaitingRow['health'], WaitingGroupKey> = {
  blocked: 'actions',
  setup: 'actions',
  unanswered: 'questions',
  proposed: 'approve',
};

function groupsFrom(waiting: WaitingRow[], open: readonly RaisedRow[]): WaitingGroup[] {
  return (['actions', 'questions', 'approve'] as const).map((key) => ({
    key,
    title: TITLE[key],
    entries: [
      ...waiting
        .filter((row) => OF_HEALTH[row.health] === key)
        .map((row) => ({ kind: 'plan' as const, id: row.id, row })),
      ...open
        .filter((raise) => (raise.consequence ? 'approve' : 'questions') === key)
        .map((raise) => ({ kind: 'raise' as const, id: raise.id, raise })),
    ],
  }));
}

function render(rows: RaisedRow[], waiting: WaitingRow[] = []): string {
  const queue = raisedQueueFrom(rows);
  return renderToStaticMarkup(
    <RaisedView queue={queue} groups={groupsFrom(waiting, queue.open)} />,
  );
}

/** A question as the plan writes one: the options lettered, one to a line. */
const QUESTION_DETAIL = [
  'A — Approve all covers plan proposals only. A request keeps its own yes.',
  'B — Approve all covers everything in the group and runs each action too.',
  'Recommend A: the one that hands a step to a routine is the one you would least want to press by accident.',
].join('\n');

function waitingRow(over: Partial<WaitingRow> = {}): WaitingRow {
  return {
    id: 'p1',
    number: 610,
    title: 'Put the Resend API key in Vercel',
    module: 'dev',
    health: 'setup',
    ask: 'Make a key at resend.com, then add RESEND_API_KEY to the Vercel project and redeploy.',
    detail: 'Make a key at resend.com, then add RESEND_API_KEY to the Vercel project and redeploy.',
    resolution: null,
    proposedBeneath: 0,
    thread: [],
    ...over,
  };
}

describe('a raise on the page', () => {
  it('says what answering yes does, and offers the two ways out', () => {
    const html = render([
      raise({
        consequence: {
          name: 'file_idea',
          text: 'Refuse a second session on a step already being worked',
          module: null,
          field: null,
        },
      }),
    ]);

    expect(html).toContain('Answering yes');
    expect(html).toContain('Refuse a second session on a step already being worked');
    expect(html).toContain('Yes, do it');
    expect(html).toContain('Close with a reason');
    expect(html).toContain('Yes, and…');
    // The box for those extra words is closed until it is asked for, so a page
    // of raises is not a page of textareas.
    expect(html).not.toContain('Anything the action above does not cover');
  });

  it('shows neither for a raise filed before it said what a yes does', () => {
    const html = render([raise()]);

    expect(html).not.toContain('Answering yes');
    expect(html).not.toContain('Yes, do it');
    expect(html).toContain(
      'Should Send to Claude refuse a step whose feature is already being worked?',
    );
    // It can still be closed, but only on a reason: a raise that closes into
    // nothing is what #367 is about.
    expect(html).toContain('Close with a reason');
  });

  // The action either ran or a reason was recorded, so a button that would run
  // it again does not belong on a row that is genuinely finished.
  it('offers nothing to press on a raise that closed on something', () => {
    const html = render([
      raise({
        status: 'answered',
        answered_at: '2026-09-13T05:00:00.000Z',
        outcome: 'Filed on the ideas page.',
        consequence: { name: 'file_idea', text: 'Refuse a second session', module: null },
      }),
    ]);

    expect(html).not.toContain('Yes, do it');
    expect(html).not.toContain('Close with a reason');
  });

  // #540's state. Answering is a reply and not the end of the row, so the row
  // offers the press that ends it -- and only once something came of it.
  it('offers to close an answered raise, and reads a closed one as done', () => {
    const answered = render([
      raise({
        status: 'answered',
        answered_at: '2026-09-13T05:00:00.000Z',
        outcome: 'Filed on the ideas page.',
      }),
    ]);

    expect(answered).toContain('Close it');
    expect(answered).toContain('Answered');

    const closed = render([
      raise({
        status: 'closed',
        answered_at: '2026-09-13T05:00:00.000Z',
        outcome: 'Filed on the ideas page.',
      }),
    ]);

    // Nothing left to press but taking it back.
    expect(closed).not.toContain('Close it');
    expect(closed).toContain('Reopen');
  });

  it('will not offer to close one that produced nothing', () => {
    const html = render([
      raise({ status: 'answered', answered_at: '2026-09-13T05:00:00.000Z', outcome: null }),
    ]);

    expect(html).not.toContain('Close it');
  });

  // The #342 raise: answered yes, closed, and nothing came of it. It reads as
  // waiting on its own follow-through rather than sitting in the history.
  it('lists a raise that closed into nothing, and offers the way to finish it', () => {
    const html = render([
      raise({
        status: 'answered',
        answered_at: '2026-09-13T05:00:00.000Z',
        outcome: null,
        consequence: { name: 'file_idea', text: 'Refuse a second session', module: null },
      }),
    ]);

    expect(html).toContain('Answered, nothing done');
    expect(html).toContain('Yes, do it');
    expect(html).toContain('Close with a reason');
  });
});

/**
 * #599: a setup job is read here as well as under its feature, and closing it
 * must not mean going to the plan and finding the row again.
 */
describe('a setup job on the page', () => {
  it('gives the one-line summary, what to do, and a press that closes it', () => {
    const html = render([], [waitingRow()]);

    // The title is the summary; the detail is the errand itself.
    expect(html).toContain('#610 Put the Resend API key in Vercel');
    expect(html).toContain('add RESEND_API_KEY to the Vercel project');
    expect(html).toContain('I have set this up');
    // Its own word, rather than the one a stopped build takes.
    expect(html).toContain('Setup');
    expect(html).not.toContain('Stopped');
  });

  it('offers no such press on the three that are closed by words', () => {
    for (const health of ['blocked', 'unanswered', 'proposed'] as const) {
      const html = render([], [waitingRow({ health })]);
      expect(html).not.toContain('I have set this up');
    }
  });
});

/**
 * #626: a question is answered here, with its options in front of you, rather
 * than sending you to the plan page to find the row first.
 */
describe('a question on the page', () => {
  const question = (over: Partial<WaitingRow> = {}) =>
    waitingRow({
      id: 'q1',
      number: 630,
      title: "Does Approve all cover Claude's requests too?",
      health: 'unanswered',
      ask: QUESTION_DETAIL,
      detail: QUESTION_DETAIL,
      ...over,
    });

  it('draws the lettered options as options, and what each costs under the fold', () => {
    const html = render([], [question()]);

    expect(html).toContain('The options');
    expect(html).toContain('Approve all covers plan proposals only');
    expect(html).toContain('Approve all covers everything in the group');
    expect(html).toContain('What each one costs');
  });

  it('offers the press that opens the answering box, and does not stand it open', () => {
    const html = render([], [question()]);

    expect(html).toContain('>Answer<');
    // Law 14: the box is asked for, not standing open on every card in the
    // list. Nothing to type in until the press.
    expect(html).not.toContain('What you decided');
    expect(html).not.toContain('<textarea');
  });

  it('shows an answer already recorded, and offers to change it', () => {
    const html = render([], [question({ resolution: 'A, and say how many it will approve.' })]);

    expect(html).toContain('Answered');
    expect(html).toContain('A, and say how many it will approve.');
    expect(html).toContain('Change the answer');
  });

  it('offers no answering box on the three kinds that are not questions', () => {
    for (const health of ['blocked', 'setup', 'proposed'] as const) {
      const html = render([], [waitingRow({ health })]);
      expect(html).not.toContain('>Answer<');
      expect(html).not.toContain('The options');
    }
  });
});

/**
 * #627: a step stopped on something only you can do is started again from here,
 * rather than from the plan page's status control.
 */
describe('a stopped step on the page', () => {
  const stopped = (over: Partial<WaitingRow> = {}) =>
    waitingRow({
      id: 'b1',
      number: 611,
      title: 'Send the weekly digest by email',
      health: 'blocked',
      ask: 'A Resend API key, so a send can be tried against a real inbox.',
      ...over,
    });

  it('says what the step needs and offers the press that starts it again', () => {
    const html = render([], [stopped()]);

    expect(html).toContain('#611 Send the weekly digest by email');
    expect(html).toContain('A Resend API key, so a send can be tried against a real inbox.');
    expect(html).toContain('I have done this');
    expect(html).toContain('Stopped');
  });

  // Nothing was built, and what the step was stopped part-way through is still
  // outstanding for whoever picks it up.
  it('sends the step back to not started rather than closing it', () => {
    const html = render([], [stopped()]);

    expect(html).toContain('name="status" value="not_started"');
    expect(html).not.toContain('value="done"');
  });

  // Note e663940b: a step stopped on a question is drawn under Questions for
  // you, and what finishes it is an answer, not the press for a job.
  it('offers an answer rather than the job press when the step asks a question', () => {
    const html = render([], [stopped({ ask: 'Should the digest go out on Sunday or Monday?' })]);

    expect(html).toContain('Answer');
    expect(html).not.toContain('I have done this');
  });

  it('offers no such press on the three that are not stopped', () => {
    for (const health of ['setup', 'unanswered', 'proposed'] as const) {
      const html = render([], [waitingRow({ health })]);
      expect(html).not.toContain('I have done this');
    }
  });
});

/**
 * #628: a proposal is approved here, one at a time or the whole group at once.
 */
describe('a proposal on the page', () => {
  const proposal = (over: Partial<WaitingRow> = {}) =>
    waitingRow({
      id: 'x1',
      number: 645,
      title: 'File what the night notices as ideas',
      health: 'proposed',
      ask: null,
      detail: null,
      ...over,
    });

  it('offers the press that approves it, carrying the row it approves', () => {
    const html = render([], [proposal()]);

    expect(html).toContain('#645 File what the night notices as ideas');
    expect(html).toContain('>Approve</button>');
    expect(html).toContain('type="hidden" name="id" value="x1"');
  });

  // Approving a proposal approves everything proposed under it, so the button
  // says what is coming with it rather than letting five steps go quietly.
  it('says how many steps come with it', () => {
    const html = render([], [proposal({ proposedBeneath: 3 })]);

    expect(html).toContain('Approve, with 3 beneath');
    expect(html).not.toContain('>Approve</button>');
  });

  it('offers no approve on the three that are not proposals', () => {
    for (const health of ['setup', 'unanswered', 'blocked'] as const) {
      const html = render([], [waitingRow({ health })]);
      expect(html).not.toContain('>Approve</button>');
      expect(html).not.toContain('Approve all');
    }
  });
});

/**
 * #630, answer A: Approve all is for plan proposals, it says how many it will
 * approve, and a request from a session keeps the yes button on its own row.
 */
describe('approving the whole group', () => {
  const proposal = (over: Partial<WaitingRow> = {}) =>
    waitingRow({ health: 'proposed', ask: null, detail: null, ...over });

  const request = (over: Record<string, unknown> = {}) =>
    raise({
      id: 'r9',
      consequence: {
        name: 'file_idea',
        text: 'Refuse a second session',
        module: null,
        field: null,
      },
      ...over,
    });

  it('counts what it will approve and sends every one of those rows', () => {
    const html = render(
      [],
      [proposal({ id: 'x1', number: 645 }), proposal({ id: 'x2', number: 647 })],
    );

    expect(html).toContain('Approve all 2');
    expect(html).toContain('type="hidden" name="id" value="x1"');
    expect(html).toContain('type="hidden" name="id" value="x2"');
  });

  // A yes on a request runs what it named there and then, which is not the
  // move Approve all is making.
  it('leaves a request out of the count and leaves it its own yes', () => {
    const html = render([request()], [proposal({ id: 'x1', number: 645 })]);

    expect(html).toContain('Approve all 1');
    expect(html).toContain('Yes, do it');
  });

  it('draws no Approve all over a group that holds only requests', () => {
    const html = render([request()], []);

    expect(html).toContain('To approve');
    expect(html).not.toContain('Approve all');
  });

  it('draws no Approve all over the two groups that are finished in words', () => {
    const html = render(
      [],
      [waitingRow({ id: 'p1' }), waitingRow({ id: 'p2', number: 611, health: 'unanswered' })],
    );

    expect(html).toContain('Your actions');
    expect(html).toContain('Questions for you');
    expect(html).not.toContain('Approve all');
  });
});

/**
 * #625: one heading with three groups under it, instead of one list sorted by
 * how pressing each row is.
 */
describe('the three groups', () => {
  it('names each group it draws and says how many rows are in it', () => {
    const html = render(
      [raise({ id: 'r1' })],
      [
        waitingRow({ id: 'p1', number: 610 }),
        waitingRow({ id: 'p2', number: 611, health: 'blocked', ask: 'A token for the repo.' }),
        waitingRow({ id: 'p3', number: 612, health: 'proposed', ask: null }),
      ],
    );

    expect(html).toContain('Your actions');
    expect(html).toContain('Questions for you');
    expect(html).toContain('To approve');
    // Two actions, one question, one to approve -- and four on the section
    // above them, which is the number the tab badge carries.
    expect(html).toContain('Waiting on you');
    expect(html).toMatch(/Your actions<span[^>]*>2</);
    expect(html).toMatch(/Questions for you<span[^>]*>1</);
    expect(html).toMatch(/To approve<span[^>]*>1</);
    expect(html).toContain('(4)');
  });

  it('leaves out a group with nothing in it', () => {
    const html = render([], [waitingRow()]);

    expect(html).toContain('Your actions');
    expect(html).not.toContain('Questions for you');
    expect(html).not.toContain('To approve');
  });

  it('still says nothing is waiting when all three are empty', () => {
    const html = render([], []);

    expect(html).toContain('Nothing waiting on you');
    expect(html).not.toContain('Your actions');
  });
});

/**
 * Note e91a8318: a raise could be talked to from Dash and a plan row could
 * not, so anything you wanted to say about a stopped step had to be said on
 * the plan page.
 */
describe('commenting on a plan row', () => {
  it('offers the box on all four kinds of waiting', () => {
    for (const health of ['blocked', 'setup', 'unanswered', 'proposed'] as const) {
      const html = render([], [waitingRow({ health })]);
      expect(html).toContain('Comment</button>');
    }
  });

  it('draws what has already been said on the step, both halves of it', () => {
    const html = render(
      [],
      [
        waitingRow({
          thread: [
            {
              id: 'c1',
              author: 'me',
              body: 'The key is ordered, it should be here Friday.',
              createdAt: '2026-09-18T09:00:00.000Z',
            },
            {
              id: 'c2',
              author: 'claude',
              body: 'Left stopped until then.',
              createdAt: '2026-09-18T09:05:00.000Z',
            },
          ],
        }),
      ],
    );

    expect(html).toContain('The key is ordered, it should be here Friday.');
    expect(html).toContain('Left stopped until then.');
    expect(html).toContain('2 comments');
  });

  // Law 14: the box is a press until it is wanted, the same as on a raise.
  it('does not stand the box open on a row with nothing said on it', () => {
    const html = render([], [waitingRow()]);

    expect(html).not.toContain('<textarea');
  });
});
