'use client';

import { OPUS } from '@/lib/core/models';
import { MeetingView, type MeetingActions } from '@/app/you/council/[id]/meeting-view';
import { parseMinutes, scorecardFrom, type BoardMeeting } from '@/lib/you/board';
import { debateFrom } from '@/lib/you/board-debate';

/**
 * A decision worked with probabilities, in the gallery (plan #2581.9): a
 * called meeting on one hard-to-undo decision, five seats forecasting blind,
 * the lean revealed, one exchange between the two most opposed, a premortem
 * and a tripwire, and the verdict waiting on the person. Also drawn with one
 * advisor's dot open, while the answers arrive, before any has, and on a
 * unanimous decision whose other side was argued as a brief. The fixtures
 * are invented and run as long as a real decision's turns do.
 */

const NOW = Date.parse('2026-11-02T10:00:00Z');
const MEETING = '00000000-0000-4000-8000-0000000001d1';
const Q = '00000000-0000-4000-8000-0000000001e1';
const Q2 = '00000000-0000-4000-8000-0000000001e2';
const DECISION =
  'Should I take the three-month contract at the analytics firm, or keep the search full time?';

const A = {
  hiring_manager: '00000000-0000-4000-8000-0000000001a1',
  mentor: '00000000-0000-4000-8000-0000000001a2',
  skeptic: '00000000-0000-4000-8000-0000000001a3',
  cfo: '00000000-0000-4000-8000-0000000001a4',
  dreamer: '00000000-0000-4000-8000-0000000001a5',
} as const;

const advisorRows = [
  {
    id: A.hiring_manager,
    key: 'hiring_manager',
    name: 'Hiring manager',
    kind: 'seat',
    question: 'Would I interview you for the roles you are applying to?',
    focus: null,
  },
  {
    id: A.mentor,
    key: 'mentor',
    name: 'Mentor',
    kind: 'seat',
    question: 'Does this build toward a career you would want in ten years?',
    focus: null,
  },
  {
    id: A.skeptic,
    key: 'skeptic',
    name: 'Skeptic',
    kind: 'seat',
    question: 'Do your hours match what you say matters?',
    focus: null,
  },
  {
    id: A.cfo,
    key: 'cfo',
    name: 'CFO',
    kind: 'seat',
    question: 'What does this cost, and can you afford it?',
    focus: null,
  },
  {
    id: A.dreamer,
    key: 'dreamer',
    name: 'Dreamer',
    kind: 'seat',
    question: 'Which dream does this keep alive, or quietly drop?',
    focus: null,
  },
];

const options = [
  { letter: 'A', text: 'Take the contract, full time, from 16 November' },
  { letter: 'B', text: 'Keep the search full time and say no' },
  { letter: 'C', text: 'Ask for three days a week and keep two for the search', added: true },
];

const money = (low: number, high: number) => ({ low, high, unit: 'a month' });

type Turn = Record<string, unknown>;
let position = 0;
const turn = (over: Turn): Turn => ({
  id: `00000000-0000-4000-8000-${String(1000 + position).padStart(12, '0')}`,
  question_id: Q,
  round: 1,
  addressed_to: null,
  kind: 'opening',
  receipts: [],
  blind: false,
  position: position++,
  ...over,
});

const opening = (advisor: string, over: Turn): Turn =>
  turn({
    advisor_id: advisor,
    round: 1,
    kind: 'opening',
    blind: true,
    model: OPUS,
    ...over,
  });

const openings: Turn[] = [
  opening(A.hiring_manager, {
    assessment: 'Would I interview you for the roles you are applying to?',
    text: 'Take it: three months of shipped analytics work is the line your résumé is missing. Of the 31 finance roles you applied to since August, the four that reached a person all asked about recent hands-on work [9b1c2e44], and the contract is exactly that. A gap of three months is easy to explain; a gap of six with nothing in it is not.',
    probabilities: { A: 0.62, B: 0.3, C: 0.48 },
    ranges: { A: money(5200, 6800), B: money(0, 5500), C: money(3100, 4200) },
    budget: { A: 55, B: 10, C: 35 },
    change_mind:
      'If the contract work is reporting rather than modelling, it adds little to the résumé and I move toward C.',
    receipts: [{ label: 'the four replies', link: '/jobs/roles' }],
  }),
  opening(A.mentor, {
    assessment: 'Does this build toward a career you would want in ten years?',
    text: 'Three days is the better bet: it keeps the work that teaches you and the search that gets you where you want to be. You wrote in [Ten years](/vault/n/Me/Ten%20years.md) that you want to run a finance team, not to be the best analyst on one. A full-time contract fills the calendar with the second.',
    probabilities: { A: 0.35, B: 0.28, C: 0.58 },
    ranges: { A: money(5200, 6800), B: money(0, 5000), C: money(3000, 4200) },
    budget: { A: 20, B: 15, C: 65 },
    change_mind: 'If the firm says three days is not on offer, I would take A over B.',
  }),
  opening(A.skeptic, {
    assessment: 'Do your hours match what you say matters?',
    text: 'You say the search matters most, and last month it got eleven hours against forty-two on side projects [c41d0a2e]. A full-time contract would take those eleven too. The search would stop, quietly, and in February you would be where you are now with a contract ending.',
    probabilities: { A: 0.22, B: 0.4, C: 0.36 },
    ranges: { A: money(5200, 6800), B: money(0, 6000), C: money(3000, 4200) },
    budget: { A: 10, B: 50, C: 40 },
    change_mind: 'Two weeks in which the search gets ten hours a week while the contract runs.',
  }),
  opening(A.cfo, {
    assessment: 'What does this cost, and can you afford it?',
    text: 'Take the contract. Your savings cover four more months at £2,900 a month [money/runway], and the search has averaged nine weeks from first call to offer for the roles you want. Without income the runway ends before a likely start date; with the contract it lasts to next autumn.',
    probabilities: { A: 0.74, B: 0.18, C: 0.55 },
    ranges: { A: money(5200, 6800), B: money(0, 4500), C: money(3100, 4200) },
    budget: { A: 70, B: 0, C: 30 },
    change_mind: 'An offer in the next four weeks, which would make the runway question moot.',
    receipts: [{ label: 'runway', link: '/money' }],
  }),
  opening(A.dreamer, {
    assessment: 'Which dream does this keep alive, or quietly drop?',
    text: 'Three days keeps Thursday evenings in the studio; full time ends them by December. The song you saved in October is the first file in that folder since June.',
    probabilities: { A: 0.3, B: 0.33, C: 0.52 },
    ranges: { A: money(5200, 6800), B: money(0, 5000), C: money(3000, 4200) },
    budget: { A: 15, B: 20, C: 65 },
    change_mind: 'If Thursdays are protected in writing under A, I would back it.',
  }),
];

const leanTurns: Turn[] = [
  turn({
    advisor_id: A.hiring_manager,
    round: 2,
    kind: 'reply',
    text: 'On your lean: it does not move me. C is a fine second, but a part-time contract reads as part-time on a résumé.',
  }),
  turn({
    advisor_id: A.mentor,
    round: 2,
    kind: 'reply',
    text: 'On your lean: it is mine too, so no move.',
  }),
  turn({
    advisor_id: A.cfo,
    round: 2,
    kind: 'reply',
    text: 'On your lean: C pays £3,600 a month, which still covers the £2,900. I raise C a little.',
    probabilities: { A: 0.74, B: 0.18, C: 0.6 },
    budget: { A: 60, B: 0, C: 40 },
  }),
];

const exchangeTurns: Turn[] = [
  turn({
    advisor_id: A.skeptic,
    round: 2,
    kind: 'reply',
    addressed_to: A.cfo,
    text: 'CFO, you count the runway and not the hours. The money buys time only if the time goes to the search, and nothing in the last month says it would.',
  }),
  turn({
    advisor_id: A.cfo,
    round: 2,
    kind: 'reply',
    addressed_to: A.skeptic,
    text: 'Skeptic, the hours are a habit and the runway is arithmetic. A habit can change by Monday; four months of savings cannot be stretched to nine. I hold A, and I move C up because it gives you both.',
    probabilities: { A: 0.7, B: 0.18, C: 0.62 },
    budget: { A: 55, B: 0, C: 45 },
  }),
  turn({
    advisor_id: A.skeptic,
    round: 2,
    kind: 'reply',
    addressed_to: A.cfo,
    text: 'CFO, fair on the arithmetic. I move B down: saying no with four months left is the riskier bet. C, with the two days in the diary, is where I land.',
    probabilities: { A: 0.25, B: 0.3, C: 0.45 },
    budget: { A: 10, B: 30, C: 60 },
  }),
];

const verdict = {
  method: 'full',
  recommended: 'C',
  probability: { A: 0.48, B: 0.27, C: 0.55 },
  spread: { A: 0.52, B: 0.22, C: 0.22 },
  spread_max: 0.52,
  forecasts: [],
  scores: [],
  conditions: [
    'Only if the firm agrees to three days in writing; if it will not, the CFO and the hiring manager would take A.',
    'The two search days go in the diary as Monday and Friday before the contract starts.',
  ],
  dissent: [
    {
      advisor: 'cfo',
      option: 'A',
      text: 'The hours are a habit and the runway is arithmetic. A habit can change by Monday; four months of savings cannot be stretched to nine.',
    },
  ],
  would_change: ['An offer in the next four weeks.', 'The firm saying three days is not on offer.'],
  assumptions: [],
};

const premortem = [
  {
    advisor: 'hiring_manager',
    text: 'The three days went to reporting, not modelling, and in February the contract read as filler.',
    signal: 'The first two weeks’ work is dashboards, not models.',
  },
  {
    advisor: 'mentor',
    text: 'The two search days filled with contract work as the firm leaned on you, and by Christmas it was full time in all but name.',
    signal: 'A search day lost to the contract in the first fortnight.',
  },
  {
    advisor: 'skeptic',
    text: 'The search days became side-project days. Applications fell to two a week and the pipeline dried up by January.',
    signal: 'Fewer than five applications in the first two weeks.',
  },
  {
    advisor: 'cfo',
    text: 'Three days paid less than you planned once tax was taken, and savings fell faster than expected.',
    signal: 'The first month’s pay below £3,300 after tax.',
  },
  {
    advisor: 'dreamer',
    text: 'Thursdays went too. The studio folder has nothing in it from November.',
    signal: 'No studio evening in the first two weeks.',
  },
];

const tripwire = {
  condition:
    'Fewer than five applications sent in the first two weeks of the contract, in job_search.applications.',
  check_on: '2026-12-01',
  status: 'watching',
};

const questionRow = (over: Record<string, unknown> = {}) => ({
  id: Q,
  question: DECISION,
  options,
  status: 'discussing',
  verdict,
  decided_option: null,
  decision_note: null,
  decided_at: null,
  created_at: '2026-11-01T12:00:00Z',
  door: 'one_way',
  success_measure: 'An offer in finance by 31 March 2027 without savings falling below £3,000.',
  decide_by: '2026-11-06',
  lean: 'C',
  option_order: {
    hiring_manager: ['B', 'C', 'A'],
    mentor: ['A', 'B', 'C'],
    skeptic: ['C', 'A', 'B'],
    cfo: ['B', 'A', 'C'],
    dreamer: ['C', 'B', 'A'],
  },
  premortem,
  tripwire,
  ...over,
});

const full = debateFrom(
  [questionRow()],
  [...openings, ...leanTurns, ...exchangeTurns],
  advisorRows,
  [Q],
);

const runningDebate = debateFrom(
  [questionRow({ verdict: null, premortem: null, tripwire: null })],
  openings.slice(0, 3),
  advisorRows,
  [Q],
);

const emptyDebate = debateFrom(
  [questionRow({ verdict: null, premortem: null, tripwire: null })],
  [],
  advisorRows,
  [Q],
);

/* A unanimous decision: every advisor put most points on A, so the dreamer
 * argued for B as a brief and the mentor answered it. */
const STUDIO = 'Should the studio evening move from Thursday to Sunday morning?';
let p2 = 100;
const t2 = (over: Turn): Turn => ({
  id: `00000000-0000-4000-8000-${String(2000 + p2).padStart(12, '0')}`,
  question_id: Q2,
  round: 1,
  addressed_to: null,
  kind: 'opening',
  receipts: [],
  blind: true,
  position: p2++,
  ...over,
});
const unanimous = debateFrom(
  [
    {
      id: Q2,
      question: STUDIO,
      options: [
        { letter: 'A', text: 'Move it to Sunday, 9 to 11' },
        { letter: 'B', text: 'Keep Thursday evening' },
      ],
      status: 'discussing',
      verdict: {
        method: 'full',
        recommended: 'A',
        probability: { A: 0.71, B: 0.32 },
        spread: { A: 0.12, B: 0.15 },
        spread_max: 0.15,
        forecasts: [],
        scores: [],
        conditions: ['Only if Sunday mornings stay free of the job search.'],
        dissent: [],
        would_change: ['A Sunday shift at the contract.'],
        assumptions: [],
        steelman: { advisor: 'dreamer', option: 'B' },
      },
      created_at: '2026-11-01T12:00:00Z',
      door: 'one_way',
      success_measure: 'Two finished songs by 1 March 2027.',
      decide_by: '2026-11-08',
      premortem: [
        {
          advisor: 'mentor',
          text: 'Sunday mornings went to errands by December.',
          signal: 'A Sunday missed in November.',
        },
      ],
      tripwire: {
        condition: 'Fewer than three Sunday sessions logged by 30 November.',
        check_on: '2026-11-30',
        status: 'watching',
      },
    },
  ],
  [
    t2({
      advisor_id: A.mentor,
      text: 'Sunday at nine is the one slot in your week nothing else has claimed.',
      probabilities: { A: 0.72, B: 0.3 },
      budget: { A: 80, B: 20 },
      ranges: { A: { low: 1, high: 3, unit: 'songs' }, B: { low: 0, high: 2, unit: 'songs' } },
    }),
    t2({
      advisor_id: A.skeptic,
      text: 'Thursdays were skipped four times in six weeks; Sundays have no rival.',
      probabilities: { A: 0.66, B: 0.25 },
      budget: { A: 75, B: 25 },
      ranges: { A: { low: 1, high: 2, unit: 'songs' }, B: { low: 0, high: 1, unit: 'songs' } },
    }),
    t2({
      advisor_id: A.dreamer,
      text: 'Mornings are when you write words; the songs need both.',
      probabilities: { A: 0.75, B: 0.4 },
      budget: { A: 60, B: 40 },
      ranges: { A: { low: 1, high: 3, unit: 'songs' }, B: { low: 0, high: 2, unit: 'songs' } },
    }),
    t2({
      advisor_id: A.dreamer,
      round: 2,
      kind: 'reply',
      blind: false,
      addressed_to: A.mentor,
      text: 'Arguing for B, which nobody backed: Thursday is the evening the band rehearses next door, and the two songs you finished this year both started from what you heard through the wall.',
    }),
    t2({
      advisor_id: A.mentor,
      round: 2,
      kind: 'reply',
      blind: false,
      addressed_to: A.dreamer,
      text: 'Dreamer, the wall is a real source, but four skipped Thursdays in six weeks says the slot does not hold. I stay on A.',
    }),
  ],
  advisorRows,
  [Q2],
);

const meeting = (over: Partial<BoardMeeting> = {}): BoardMeeting => ({
  id: MEETING,
  kind: 'called',
  decision: DECISION,
  status: 'ready',
  heldOn: '2026-11-02',
  error: null,
  runUrl: null,
  requestedAt: '2026-11-02T08:41:00Z',
  startedAt: '2026-11-02T08:42:00Z',
  finishedAt: '2026-11-02T09:30:00Z',
  ...over,
});

const actions: MeetingActions = {
  vote: async () => ({ error: null, saved: null }),
  answer: async () => ({ error: null, saved: null }),
  tick: async () => ({ error: null, saved: null }),
  makeTodo: async () => ({ error: null, saved: null }),
};

export function YouBoardDecisionPreview({
  state = 'ready',
  openDot,
}: {
  state?: 'ready' | 'running' | 'empty' | 'steelman';
  /** The advisor key whose dot on the strip is open. */
  openDot?: string;
}) {
  const running = state === 'running' || state === 'empty';
  const steel = state === 'steelman';
  const title = steel ? STUDIO : DECISION;
  return (
    <MeetingView
      meeting={
        running
          ? meeting({
              status: 'running',
              heldOn: null,
              finishedAt: null,
              startedAt: '2026-11-02T09:41:00Z',
            })
          : meeting(steel ? { decision: STUDIO } : {})
      }
      minutes={parseMinutes(running ? null : { agenda: [steel ? Q2 : Q] })}
      marks={[]}
      debate={
        state === 'running'
          ? runningDebate
          : state === 'empty'
            ? emptyDebate
            : steel
              ? unanimous
              : full
      }
      scorecard={scorecardFrom([])}
      subject={{
        ref: null,
        path: [
          { label: 'You', href: '/you' },
          { label: 'Council', href: '/you/council' },
          { label: 'Decisions', href: '/you/council/decisions' },
          { label: title, href: `/you/council/${MEETING}` },
        ],
      }}
      timezone="Europe/London"
      now={NOW}
      actions={actions}
      decide={async () => ({ error: null })}
      open={openDot ? { dot: openDot } : {}}
    />
  );
}
