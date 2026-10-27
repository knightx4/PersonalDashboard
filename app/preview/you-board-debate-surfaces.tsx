'use client';

import { MeetingView, type MeetingActions } from '@/app/you/board/[id]/meeting-view';
import { parseMinutes, scorecardFrom, type BoardMeeting } from '@/lib/you/board';
import { debateFrom } from '@/lib/you/board-debate';

/**
 * A meeting held as a debate, in the gallery (plan #2561.5): two questions,
 * the first argued by the five seats and a guest through all three rounds,
 * the second unanimous in round 1 so two advisors argue the option nobody
 * backed. Drawn finished, still being held with the second question not yet
 * reached, and with one advisor's thinking open. The fixtures are invented
 * and run as long as a real meeting's turns do.
 */

const NOW = Date.parse('2026-11-02T10:00:00Z');
const MEETING = '00000000-0000-4000-8000-0000000000d1';
const Q1 = '00000000-0000-4000-8000-0000000000e1';
const Q2 = '00000000-0000-4000-8000-0000000000e2';

const A = {
  hiring_manager: '00000000-0000-4000-8000-0000000000a1',
  mentor: '00000000-0000-4000-8000-0000000000a2',
  skeptic: '00000000-0000-4000-8000-0000000000a3',
  cfo: '00000000-0000-4000-8000-0000000000a4',
  dreamer: '00000000-0000-4000-8000-0000000000a5',
  buffett: '00000000-0000-4000-8000-0000000000a6',
} as const;

const advisorRows = [
  { id: A.hiring_manager, key: 'hiring_manager', name: 'Hiring manager', kind: 'seat', question: 'Would I interview you for the roles you are applying to?', focus: 'This month: the pipeline, where each application stalled, and how your materials read.' },
  { id: A.mentor, key: 'mentor', name: 'Mentor', kind: 'seat', question: 'Does this build toward a career you would want in ten years?', focus: 'Five to ten years: what you are building, and what you are not.' },
  { id: A.skeptic, key: 'skeptic', name: 'Skeptic', kind: 'seat', question: 'Do your hours match what you say matters?', focus: 'Right now: stated priorities beside where the time went.' },
  { id: A.cfo, key: 'cfo', name: 'CFO', kind: 'seat', question: 'What does this cost, and can you afford it?', focus: 'Six to twelve months: spending, runway and income.' },
  { id: A.dreamer, key: 'dreamer', name: 'Dreamer', kind: 'seat', question: 'Which dream does this keep alive, or quietly drop?', focus: 'No horizon: the big ambitions in your own notes, and the smallest thread that keeps one going.' },
  {
    id: A.buffett,
    key: 'buffett',
    name: 'Warren Buffett',
    kind: 'guest',
    question: 'Will you still be glad of this in twenty years?',
    focus: 'Long-term value, staying inside what you understand, and a margin of safety.',
    sources: [
      { label: 'Berkshire Hathaway shareholder letters, 1977 to 2024', link: 'https://www.berkshirehathaway.com/letters/letters.html' },
      { label: 'Remarks to University of Florida business students, 1998', link: 'https://www.youtube.com/watch?v=2MHIcabnjrA' },
      { label: 'The Snowball, by Alice Schroeder', link: 'https://en.wikipedia.org/wiki/The_Snowball' },
    ],
  },
];

const questionRows = [
  {
    id: Q1,
    question:
      'Should I take the three-month contract at the analytics firm, or keep the search full time?',
    options: [
      { letter: 'A', text: 'Take the contract, full time, from 16 November' },
      { letter: 'B', text: 'Keep the search full time and say no' },
      { letter: 'C', text: 'Ask for three days a week and keep two for the search' },
    ],
    status: 'discussing',
    verdict: {
      recommended: 'A',
      conditions: [
        'Get one evening a week written into the contract before you sign.',
        'Keep two applications a week going through the three months.',
      ],
      dissent: [
        { advisor: 'mentor', text: 'Three days keeps two warm interviews alive and still moves the runway to May.' },
        { advisor: 'dreamer', text: 'Nothing in your notes dreams about analytics, and the last contract took the album from weekly to nothing in five weeks.' },
      ],
      would_change: [
        'The firm will not put an evening in writing: C becomes the better ask.',
        'A second interview lands in the first two weeks: B costs less than it did.',
      ],
      scores: [],
    },
    created_at: '2026-10-29T09:00:00Z',
  },
  {
    id: Q2,
    question: 'Should the studio evening move from Thursday to Sunday morning?',
    options: [
      { letter: 'A', text: 'Move it to Sunday, 9 to 11' },
      { letter: 'B', text: 'Keep Thursday evening' },
    ],
    status: 'discussing',
    verdict: {
      recommended: 'A',
      conditions: ['Book the Sunday studio by Friday.'],
      dissent: [],
      would_change: ['Sunday morning fills with something else before it is booked.'],
      scores: [],
    },
    created_at: '2026-10-30T09:00:00Z',
  },
];

let position = 0;
const turn = (
  question: string,
  round: 1 | 2 | 3,
  advisor: keyof typeof A,
  text: string,
  scores: Record<string, number> | null,
  to: keyof typeof A | null = null,
  receipts: { label: string; link: string }[] = [],
) => ({
  id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
  question_id: question,
  round,
  advisor_id: A[advisor],
  addressed_to: to ? A[to] : null,
  kind: round === 1 ? 'opening' : round === 2 ? 'reply' : 'vote',
  text,
  scores,
  receipts,
  position: position++,
});

const ROLES = { label: 'Roles, 31 applied', link: '/jobs/roles' };
const RUNWAY = { label: 'Runway, October', link: '/money' };

const q1Turns = [
  turn(Q1, 1, 'hiring_manager', 'Of the 31 roles you applied to since August, 24 asked for "recent hands-on analytics". The contract is exactly that line on the résumé. Taking it full time stops the search for three months, but you come back to it with the thing screeners are filtering on. I back A. Your lean is C, and the case against it is that a contractor at three days reads as part time to the firm and to the next screener.', { A: 8, B: 4, C: 6 }, null, [ROLES]),
  turn(Q1, 1, 'mentor', 'The work matters more than the title. Their team builds forecasting for logistics, which is two steps from the energy roles you say you want in five years. Three days lets you do the work and keep two warm interviews alive. I back C.', { A: 6, B: 3, C: 8 }),
  turn(Q1, 1, 'skeptic', 'You have said the search is the priority for six weeks running, and in October it got eleven hours a week on average. Full time on the search has not meant full time. B scores low because it describes a week you have not had. I back A, with a hunch that structure helps you more than freedom does.', { A: 7, B: 2, C: 5 }),
  turn(Q1, 1, 'cfo', 'At the October rate the savings last until early March. The contract pays £14,400 over three months, which moves that to July. C pays £8,640 and moves it to May. Both are better than B, which spends a month of runway for every month the search takes. I back A.', { A: 9, B: 2, C: 7 }, null, [RUNWAY]),
  turn(Q1, 1, 'dreamer', 'Nothing in your notes dreams about analytics. The essay series and the album do, and both stopped the last time work was full time. C keeps two days that could hold a thread of either. I back C.', { A: 3, B: 5, C: 8 }),
  turn(Q1, 1, 'buffett', 'Stay inside what you understand. You know analytics work and you know how you behave without structure. A contract with a fixed end and a known payer is a margin of safety, and that is what I would want first. I back A.', { A: 8, B: 3, C: 6 }),

  turn(Q1, 2, 'dreamer', 'Hiring manager, you count the line on the résumé and not what three months of full time costs you outside it. The last contract took the album from weekly to nothing in five weeks.', null, 'hiring_manager'),
  turn(Q1, 2, 'hiring_manager', 'Dreamer, that is fair about the album, and it does not change what the screeners filter on. A part-time line reads as a gap filled. I stay where I was.', null, 'dreamer'),
  turn(Q1, 2, 'dreamer', 'Then ask for the full-time contract with one evening that is yours in writing. If they say no to that, it tells you about the three months.', { A: 5, B: 4, C: 8 }, 'hiring_manager'),
  turn(Q1, 2, 'hiring_manager', 'An evening in writing costs them nothing and keeps the line whole. That moves me towards C a little, since C is the same ask made bigger.', { A: 8, B: 4, C: 7 }, 'dreamer'),
  turn(Q1, 2, 'mentor', 'CFO, you price the runway and not the next role. A contract that ends in February lands you in the slowest hiring month of the year.', null, 'cfo'),
  turn(Q1, 2, 'cfo', 'Mentor, February is slow, and July runway means February does not matter. Without the contract, you would be choosing in February with five weeks of money left.', null, 'mentor'),

  turn(Q1, 3, 'hiring_manager', 'A, with one evening written into the contract. The screeners want the line.', { A: 8, B: 3, C: 7 }),
  turn(Q1, 3, 'mentor', 'C. The CFO is right that the runway matters, and three days still moves it to May.', { A: 6, B: 3, C: 8 }),
  turn(Q1, 3, 'skeptic', 'A. Nothing in round 2 answered the eleven hours.', { A: 8, B: 2, C: 5 }),
  turn(Q1, 3, 'cfo', 'A. July, not May.', { A: 9, B: 2, C: 7 }),
  turn(Q1, 3, 'dreamer', 'C, and A only with the evening in writing.', { A: 5, B: 4, C: 8 }),
  turn(Q1, 3, 'buffett', 'A. The evening is a good clause; a margin of safety for the album too.', { A: 8, B: 2, C: 6 }),
];

const q2Turns = [
  turn(Q2, 1, 'skeptic', 'Thursday evenings were skipped four times out of six in October. Sunday mornings have nothing booked in them. Move it.', { A: 8, B: 3 }),
  turn(Q2, 1, 'dreamer', 'Mornings are when the songs in your notes were written. Move it.', { A: 9, B: 2 }),
  turn(Q2, 1, 'cfo', 'No cost either way. Move it, since Sunday makes it more likely to happen.', { A: 7, B: 4 }),
  turn(Q2, 2, 'skeptic', 'Arguing for B, which nobody backed: Dreamer, Thursday is the one evening with the studio booked and paid for. Sunday has no booking, and a session nobody booked is the first to go.', null, 'dreamer'),
  turn(Q2, 2, 'dreamer', 'Skeptic, that is the best case for Thursday, and it is about the booking, not the day. Book Sunday.', null, 'skeptic'),
  turn(Q2, 3, 'skeptic', 'A, with Sunday booked by Friday.', { A: 8, B: 3 }),
  turn(Q2, 3, 'dreamer', 'A.', { A: 9, B: 2 }),
  turn(Q2, 3, 'cfo', 'A.', { A: 7, B: 3 }),
];

/** The same questions after the person decided: the first against the board, the second with it. */
const decidedRows = questionRows.map((row, i) =>
  i === 0
    ? {
        ...row,
        status: 'decided',
        decided_option: 'C',
        decision_note:
          'Asking for three days. If they say no I take A, with the evening in writing.',
        decided_at: '2026-11-01T20:15:00Z',
      }
    : { ...row, status: 'decided', decided_option: 'A', decision_note: null, decided_at: '2026-11-01T20:16:00Z' },
);

const turns = [...q1Turns, ...q2Turns];

/**
 * Make it happen (plan #2561.9): the contract question decided as the board
 * recommended, so its conditions are offered with the option. The first
 * condition carries a date.
 */
const makeRows = [
  {
    ...questionRows[0],
    verdict: {
      ...questionRows[0].verdict,
      conditions: [
        'Get one evening a week written into the contract before you sign, by 13 November.',
        'Keep two applications a week going through the three months.',
      ],
    },
    status: 'decided',
    decided_option: 'A',
    decision_note: null,
    decided_at: '2026-11-01T20:15:00Z',
  },
];
const makeDebate = debateFrom(makeRows, q1Turns, advisorRows, [Q1]);
const MADE = {
  todo: '00000000-0000-4000-8000-0000000000f1',
  step: '00000000-0000-4000-8000-0000000000f2',
};
/** After the action was written as a todo: the condition still to write, the action listed. */
const madeDebate = {
  ...makeDebate,
  questions: makeDebate.questions.map((q) => ({
    ...q,
    made: [
      {
        kind: 'todo' as const,
        id: MADE.todo,
        key: 'action',
        title: 'Take the contract, full time, from 16 November',
        dueOn: '2026-11-16',
        done: false,
        href: `/todo/all?status=all&focus=${MADE.todo}`,
        goal: null,
      },
    ],
  })),
};
const GOALS = [
  { id: '00000000-0000-4000-8000-0000000000b1', title: 'Land a senior analytics role by February', area: 'Career' },
  { id: '00000000-0000-4000-8000-0000000000b2', title: 'Release the second album', area: 'Music' },
  { id: '00000000-0000-4000-8000-0000000000b3', title: 'Keep the runway above six months', area: 'Money' },
];
const makeAction = async () => ({ error: null });
const debate = debateFrom(questionRows, turns, advisorRows, [Q1, Q2]);
const decidedDebate = debateFrom(decidedRows, turns, advisorRows, [Q1, Q2]);
/** Still being held: the first question's first round so far, the second not reached. */
const runningDebate = debateFrom(questionRows, q1Turns.slice(0, 4), advisorRows, [Q1, Q2]);

const minutes = parseMinutes({
  agenda: [Q1, Q2],
  since:
    'This is the first meeting held as a debate. You asked about the contract on Thursday and accepted the studio question from last week’s suggestions.',
  dream: {
    text: 'The album is the dream in more of your notes than any other, and it has had no session since 8 October.',
    thread: 'One session on Sunday morning, booked by Friday.',
  },
  predictions: [
    { seat: 'hiring_manager', text: 'If you take the contract, two recruiters reply within a fortnight of the résumé changing.' },
    { seat: 'mentor', text: 'They agree to three days if you ask before Wednesday.' },
    { seat: 'skeptic', text: 'Sunday’s session happens if it is booked by Friday, and not if it is not.' },
    { seat: 'cfo', text: 'October’s spending comes in under £1,900.' },
    { seat: 'dreamer', text: 'A second export is in the song folder by 8 November.' },
  ],
  graded_note: 'None. This is the first meeting held as a debate.',
  scorecard: [],
  chair_note:
    'The five seats sat on both questions. Warren Buffett sat on the contract, since it is a question of margin and of staying inside what you know. No other guest’s question fitted either.',
});

const meeting = (over: Partial<BoardMeeting> = {}): BoardMeeting => ({
  id: MEETING,
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

const decide = async () => ({ error: null });

const actions: MeetingActions = {
  vote: async () => ({ error: null, saved: null }),
  answer: async () => ({ error: null, saved: null }),
  tick: async () => ({ error: null, saved: null }),
  makeTodo: async () => ({ error: null, saved: null }),
};

export function YouBoardDebatePreview({
  state = 'ready',
  advisor,
  decision,
  make,
}: {
  state?: 'ready' | 'running';
  /** Draw this advisor's thinking open. */
  advisor?: keyof typeof A;
  /** 'made': both decided. 'open': the form open on a decided question's change. 'error': the form with a failed save. */
  decision?: 'made' | 'open' | 'error';
  /** Make it happen under the decision (plan #2561.9): 'todos' as first offered, 'steps' with a goal picked and a failed write, 'made' after the action was written. */
  make?: 'todos' | 'steps' | 'made';
}) {
  const running = state === 'running';
  return (
    <MeetingView
      meeting={
        running
          ? meeting({
              status: 'running',
              heldOn: null,
              requestedAt: '2026-11-02T09:40:00Z',
              startedAt: '2026-11-02T09:41:00Z',
              finishedAt: null,
            })
          : meeting()
      }
      minutes={running ? parseMinutes(null) : minutes}
      marks={[]}
      debate={
        running
          ? runningDebate
          : make === 'made'
            ? madeDebate
            : make
              ? makeDebate
              : decision === 'made' || decision === 'open'
                ? decidedDebate
                : debate
      }
      make={
        make
          ? {
              action: makeAction,
              goals: GOALS,
              today: '2026-11-02',
              ...(make === 'steps' ? { start: { mode: 'goal' as const, goalId: GOALS[0].id } } : {}),
            }
          : undefined
      }
      scorecard={scorecardFrom([])}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Board', href: '/you/board' },
          {
            label: running ? 'Board meeting' : 'Board meeting 1 Nov 2026',
            href: `/you/board/${MEETING}`,
          },
        ],
      }}
      timezone="Europe/London"
      now={NOW}
      actions={actions}
      decide={decide}
      open={{
        ...(advisor ? { advisor: A[advisor] } : {}),
        ...(decision === 'open' || decision === 'error' ? { decide: decision } : {}),
        ...(make === 'steps' ? { make: 'error' as const } : {}),
      }}
    />
  );
}
