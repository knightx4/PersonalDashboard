'use client';

import type { CallStart } from '@/app/you/board/call-meeting';
import { BoardListView } from '@/app/you/board/board-list-view';
import { BoardListSkeleton, BoardMeetingSkeleton } from '@/app/you/board/board-skeleton';
import {
  MeetingView,
  type MeetingActions,
  type MeetingOpen,
} from '@/app/you/board/[id]/meeting-view';
import {
  parseMinutes,
  scorecardFrom,
  type BoardMark,
  type BoardMeeting,
  type BoardMeetingRow,
} from '@/lib/you/board';

/**
 * The Board tab in the gallery (plan #2540.3): the list of meetings, one
 * meeting's minutes with some marks made, and each hidden part: the empty
 * tab, a meeting being held, one that failed, the memos open, and both
 * loading states. The fixtures are invented and run as long as a real
 * meeting's prose does.
 */

const NOW = Date.parse('2026-11-02T10:00:00Z');
const ID = '00000000-0000-4000-8000-0000000000b1';

const actions: MeetingActions = {
  vote: async (_id, item, value, note) => ({
    error: null,
    saved: saved('vote', item, value, note ?? null),
  }),
  answer: async (_id, answer) => ({
    error: null,
    saved: answer.trim() ? saved('answer', 'question', answer) : null,
  }),
  tick: async (_id, item, done) => ({
    error: null,
    saved: saved('resolution', item, done ? 'done' : 'open'),
  }),
  makeTodo: async (_id, item) => ({
    error: null,
    saved: { ...saved('resolution', item, 'open'), todoId: '00000000-0000-4000-8000-0000000000f1' },
  }),
};

function saved(
  kind: BoardMark['kind'],
  item: string,
  value: string,
  note: string | null = null,
): BoardMark {
  return { kind, item, value, note, todoId: null, markedAt: new Date(NOW).toISOString() };
}

const meeting = (over: Partial<BoardMeeting> = {}): BoardMeeting => ({
  id: ID,
  kind: 'weekly',
  decision: null,
  status: 'ready',
  heldOn: '2026-11-01',
  error: null,
  runUrl: null,
  requestedAt: '2026-11-01T18:41:00Z',
  startedAt: '2026-11-01T18:42:00Z',
  finishedAt: '2026-11-01T19:30:00Z',
  ...over,
});

const minutes = parseMinutes({
  since:
    'You sided with the mentor on publishing first and answered that the résumé, more than the roles, is what fails at screening. So this week the board read the two sends that went out after the essay, and the résumé you rewrote on Thursday ([Résumé, finance first](/vault/n/Jobs/Resume.md)). The question from last week is settled; the money point is not, because no number has been entered yet.',
  disagreements: [
    {
      key: 'd1',
      point:
        'Should the next ten applications go out with the rewritten résumé, or wait for a recruiter to read it first?',
      positions: [
        {
          seat: 'hiring_manager',
          text: 'Send them now. The two that went out with the new résumé both reached a person within four days, against one reply in the thirty-one before it. Waiting a week for a read costs ten chances to learn the same thing.',
          receipts: [{ label: 'the two replies', link: '/jobs/roles' }],
        },
        {
          seat: 'mentor',
          text: 'Have one person who hires for finance read it first. Two replies is a small sample, and a recruiter will tell you in ten minutes whether the first line reads as an operator or a builder of tools. Book it for Tuesday and send on Wednesday.',
          receipts: [],
        },
        {
          seat: 'skeptic',
          stance: 'arguing against the board’s shared view',
          text: 'Both of you assume the résumé was the problem. The two replies came from companies you had already spoken to in September, so they may be warm leads, and the rewrite may have changed nothing.',
          receipts: [{ label: 'September notes', link: '/vault/n/Jobs/September.md' }],
        },
      ],
    },
    {
      key: 'd2',
      note: 'Back from last week because it has no vote yet.',
      point: 'Does the hour in the studio come before the money numbers are entered?',
      positions: [
        {
          seat: 'cfo',
          text: 'No. The card is due on the fourth and its balance, rate and minimum are still not in Dash. Ten minutes with the statement first, then the hour.',
          receipts: [],
        },
        {
          seat: 'dreamer',
          text: 'Yes. You do the dull step straight after making something. Last week the statement sat unopened all week while the studio hour waited for it.',
          receipts: [{ label: 'About me', link: '/vault/n/Me/About%20me.md' }],
        },
      ],
    },
  ],
  dream: {
    text: 'The song stays on the table. In [Personal goals](/vault/n/Me/Personal%20Goals.md) you wrote that you wanted to put something out, anything, even if it is not very good. Last Wednesday you opened the project and saved a forty-second loop, and it is the first file in that folder since June.',
    thread:
      'Thirty minutes on Wednesday. Add one more part to the loop and export it, whatever state it is in.',
    receipts: [{ label: 'Make a song and put it out', link: '/goals' }],
  },
  question:
    'If the recruiter says the first line still reads as a builder of tools, what would you lead with instead?',
  resolutions: [
    {
      key: 'r1',
      what: 'Send the rewritten résumé to one person who hires for finance and ask for ten minutes on Tuesday 3 Nov.',
      day: '2026-11-03',
      seats: ['mentor', 'hiring_manager'],
    },
    {
      key: 'r2',
      what: 'Open the card statement and have Dash put the balance, rate and minimum on its row in [Recurring](/shopping/recurring).',
      day: '2026-11-02',
      seats: ['cfo'],
    },
    {
      key: 'r3',
      what: 'Thirty minutes in the studio on Wednesday 4 Nov: one more part, then export.',
      day: '2026-11-04',
      seats: ['dreamer'],
    },
  ],
  resolutions_note: 'Last week’s essay resolution is done and is not carried.',
  predictions_note: 'These cover 2 Nov to Sun 8 Nov.',
  predictions: [
    { seat: 'hiring_manager', text: 'At least six applications have a submitted date by 8 Nov.' },
    {
      seat: 'mentor',
      text: 'The recruiter read happens, and the first line of the résumé changes again by 8 Nov.',
    },
    { seat: 'skeptic', text: 'Neither reply turns into a scheduled interview by 8 Nov.' },
    { seat: 'cfo', text: 'The card row still has no minimum on 8 Nov.' },
    { seat: 'dreamer', text: 'A second export is in the song folder by 8 Nov.' },
  ],
  graded: [
    {
      seat: 'hiring_manager',
      text: 'Fewer than seven ready applications are sent by 1 Nov.',
      grade: 'hit',
      fact: 'Two were sent.',
    },
    {
      seat: 'mentor',
      text: 'The essay is still unpublished on 1 Nov.',
      grade: 'miss',
      fact: 'It went out on Tuesday 27 Oct.',
    },
    {
      seat: 'skeptic',
      text: 'The take-home todo is still open on 1 Nov.',
      grade: 'miss',
      fact: 'Closed on 28 Oct.',
    },
    {
      seat: 'cfo',
      text: 'The card row still shows its old update on 1 Nov.',
      grade: 'hit',
      fact: 'Last changed 12 Oct.',
    },
    {
      seat: 'dreamer',
      text: 'The song step is still unanswered on 1 Nov.',
      grade: 'cant_tell',
      fact: 'A loop was saved, but the step was not answered.',
    },
  ],
  memos_note:
    'The chair corrected the hiring manager’s count of replies: two, not three, since one was an automatic acknowledgement.',
  memos: [
    {
      seat: 'hiring_manager',
      memo: '1. The rewrite changed what happens at the first gate. Two sends, two people replying within four days.\n2. Ten roles are ready with every question answered. At this rate a week of sending is worth more than a week of polishing.',
      resolution: 'Send five on Monday and five on Thursday, each opening with a finance result.',
      prediction: 'At least six applications have a submitted date by 8 Nov.',
      rebuttal: {
        to: 'mentor',
        text: 'A recruiter read is a week you are not in anyone’s inbox. Send five first and book the read for the other five.',
      },
    },
    {
      seat: 'mentor',
      memo: 'The essay going out was the first finished thing under your name this autumn. The résumé should point at it, and a person who hires for finance should tell you whether it does.',
      resolution: 'Ask one recruiter for ten minutes on Tuesday.',
      prediction: 'The first line of the résumé changes again by 8 Nov.',
      rebuttal: {
        to: 'hiring_manager',
        text: 'Two replies is not a trend. One read now saves ten sends with the wrong first line.',
      },
    },
    {
      seat: 'skeptic',
      memo: 'Both replies were from companies you had spoken to before. What makes you sure it was the résumé?',
      rebuttal: {
        to: null,
        stance: 'arguing against the board’s shared view',
        text: 'Everyone is reading two warm replies as proof. Send three cold applications first and see.',
      },
    },
    {
      seat: 'cfo',
      memo: 'The card falls due on the fourth and the row has no minimum. Nothing else on the money side can be worked out until it does.',
      prediction: 'The card row still has no minimum on 8 Nov.',
      rebuttal: {
        to: 'dreamer',
        text: 'The studio hour costs nothing in cash. The ten minutes with the statement are the only thing due this week.',
      },
    },
    {
      seat: 'dreamer',
      memo: 'A loop exists. It is forty seconds long and it is the first thing in that folder since June.',
      prediction: 'A second export is in the song folder by 8 Nov.',
      rebuttal: {
        to: 'cfo',
        text: 'The statement was opened last time only after you had made something. Put it after the studio, not before.',
      },
    },
  ],
});

const CALLED_DECISION =
  'Should I take the three-month contract at the analytics firm, or keep the search full time?';

/** A called meeting's minutes: one disagreement holding each seat's vote and what would change it. */
const calledMinutes = parseMinutes({
  since: null,
  disagreements: [
    {
      key: 'd1',
      point: CALLED_DECISION,
      positions: [
        {
          seat: 'hiring_manager',
          stance: 'Take it',
          text: 'A finance-adjacent title on the résumé by February answers the question every screen asks. It would change if the firm will not put analytics or finance in the title.',
          receipts: [{ label: 'the contract role', link: '/jobs/roles' }],
        },
        {
          seat: 'mentor',
          stance: 'Take it, keep applying',
          text: 'Keep the search at two applications a week. Three months of real work is worth more than three months of waiting. It would change if the contract ended the weekend studio hour.',
          receipts: [],
        },
        {
          seat: 'skeptic',
          stance: 'Keep searching',
          text: 'You asked this question after two replies, and a contract is also a way to stop looking. It would change if you could name the application you would send in month two.',
          receipts: [],
        },
        {
          seat: 'cfo',
          stance: 'Take it',
          text: 'Three months of pay covers the card and moves the runway from five months to eight. It would change if the rate came in under $38 an hour.',
          receipts: [{ label: 'Recurring', link: '/shopping/recurring' }],
        },
        {
          seat: 'dreamer',
          stance: 'Keep searching, with the song kept',
          text: 'The song stays on the table either way. It would change if the contract allowed one free morning a week.',
          receipts: [{ label: 'Personal goals', link: '/vault/n/Me/Personal%20Goals.md' }],
        },
      ],
    },
  ],
  question: 'What would you need to see in the first month to know the contract was a mistake?',
  resolutions: [
    {
      key: 'r1',
      what: 'Ask the firm what title the contract carries and whether a free morning a week is possible.',
      day: '2026-11-03',
      seats: ['hiring_manager', 'dreamer'],
    },
  ],
  predictions: [{ seat: 'cfo', text: 'The rate offered is above $38 an hour.' }],
  memos: [],
});

const marks: BoardMark[] = [
  { ...saved('vote', 'd1', 'mentor', 'Two replies is too few to be sure.') },
  { ...saved('resolution', 'r2', 'done') },
  { ...saved('resolution', 'r3', 'open'), todoId: '00000000-0000-4000-8000-0000000000f2' },
];

const scorecard = scorecardFrom([minutes.graded]);

const subject = {
  ref: null,
  path: [
    { label: 'You', href: '/you' },
    { label: 'Board', href: '/you/board' },
    { label: 'Board meeting 1 Nov 2026', href: `/you/board/${ID}` },
  ],
};

export function YouBoardMeetingPreview({
  state = 'ready',
  open,
}: {
  state?: 'ready' | 'running' | 'failed' | 'called';
  open?: MeetingOpen;
}) {
  const shown =
    state === 'running'
      ? meeting({
          status: 'running',
          heldOn: null,
          requestedAt: '2026-11-02T09:40:00Z',
          startedAt: '2026-11-02T09:41:00Z',
          finishedAt: null,
        })
      : state === 'failed'
        ? meeting({
            status: 'failed',
            heldOn: null,
            requestedAt: '2026-11-02T09:40:00Z',
            finishedAt: '2026-11-02T09:52:00Z',
            error:
              'The meeting stopped before the minutes were written: the routine answered 529, overloaded.',
          })
        : state === 'called'
          ? meeting({ kind: 'called', decision: CALLED_DECISION, heldOn: '2026-11-02' })
          : meeting();
  return (
    <MeetingView
      meeting={shown}
      minutes={state === 'ready' ? minutes : state === 'called' ? calledMinutes : parseMinutes(null)}
      marks={state === 'ready' ? marks : []}
      scorecard={scorecard}
      subject={{
        ...subject,
        path: [
          ...subject.path.slice(0, 2),
          {
            label: state === 'ready' ? 'Board meeting 1 Nov 2026' : state === 'called' ? CALLED_DECISION : 'Board meeting',
            href: `/you/board/${ID}`,
          },
        ],
      }}
      timezone="Europe/London"
      now={NOW}
      actions={actions}
      open={open}
    />
  );
}

const row = (over: Partial<BoardMeetingRow>): BoardMeetingRow => ({
  ...meeting(),
  counts: { disagreements: 3, voted: 0, resolutions: 3, done: 0, answered: false },
  ...over,
});

const rows: BoardMeetingRow[] = [
  row({
    id: '00000000-0000-4000-8000-0000000000c1',
    kind: 'called',
    decision:
      'Should I take the three-month contract at the analytics firm, or keep the search full time?',
    heldOn: '2026-11-02',
    counts: { disagreements: 2, voted: 0, resolutions: 2, done: 0, answered: false },
  }),
  row({ counts: { disagreements: 2, voted: 1, resolutions: 3, done: 1, answered: false } }),
  row({
    id: '00000000-0000-4000-8000-0000000000b0',
    heldOn: '2026-10-25',
    counts: { disagreements: 3, voted: 3, resolutions: 3, done: 2, answered: true },
  }),
  row({
    id: '00000000-0000-4000-8000-0000000000af',
    heldOn: '2026-10-18',
    counts: { disagreements: 3, voted: 0, resolutions: 3, done: 0, answered: false },
  }),
];

export function YouBoardListPreview({
  state = 'ready',
  start,
}: {
  state?: 'ready' | 'running' | 'empty';
  start?: CallStart;
}) {
  const meetings =
    state === 'empty'
      ? []
      : state === 'running'
        ? [
            row({
              id: '00000000-0000-4000-8000-0000000000d1',
              kind: 'called',
              decision:
                'Should I take the three-month contract at the analytics firm, or keep the search full time?',
              status: 'running',
              heldOn: null,
              requestedAt: '2026-11-02T09:40:00Z',
              startedAt: '2026-11-02T09:41:00Z',
              counts: { disagreements: 0, voted: 0, resolutions: 0, done: 0, answered: false },
            }),
            ...rows.slice(1),
          ]
        : rows;
  return (
    <BoardListView
      meetings={meetings}
      nextMeeting="2026-11-08"
      timezone="Europe/London"
      now={NOW}
      actions={{ call: async () => ({ error: null }) }}
      start={start}
    />
  );
}

export function YouBoardListLoadingPreview() {
  return <BoardListSkeleton />;
}

export function YouBoardMeetingLoadingPreview() {
  return <BoardMeetingSkeleton />;
}
