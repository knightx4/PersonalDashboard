import NewTrackPage from '@/app/learn/new/page';
import NewQuizPage from '@/app/learn/quiz/new/page';
import { ConceptPageView } from '@/app/learn/c/[id]/concept-view';
import { ListsView } from '@/app/learn/lists/lists-view';
import { OpeningView } from '@/app/learn/opening/[id]/opening-view';
import { QuizView } from '@/app/learn/quiz/[id]/quiz-view';
import { TakeQuizView } from '@/app/learn/quiz/[id]/take/take-view';
import { ReadingView } from '@/app/learn/r/[id]/reading-view';
import { PiecePageView } from '@/app/learn/s/[id]/p/[piece]/piece-page-view';
import { ProbeView } from '@/app/learn/s/[id]/probe/probe-view';
import { VideosView } from '@/app/learn/videos/videos-view';
import { ListVideoView } from '@/app/learn/videos/[videoId]/video-view';
import { ChannelView } from '@/app/learn/youtube/[slug]/channel-view';
import { PlaylistView } from '@/app/learn/youtube/p/[id]/playlist-view';
import { LibraryVideoView } from '@/app/learn/youtube/v/[videoId]/library-video-view';
import type { ClaimMaterialView } from '@/lib/learn/catalogue/material';
import type { Concept } from '@/lib/learn/graph/model';
import type { ProbeRow } from '@/lib/learn/graph/session';
import type { OpeningSweep } from '@/lib/learn/graph/opening';
import type { CardNote } from '@/lib/learn/notes/notes';
import type { NestedTrack } from '@/lib/learn/tracks/tree';
import type { TrackSummary, ReadingDetail } from '@/lib/learn/tracks/load';
import type { Quiz } from '@/lib/learn/quiz/model';
import type { QuizMaterial } from '@/lib/learn/quiz/material';
import type { PiecePage } from '@/lib/learn/lessons/piece-store';
import type { PracticeView } from '@/lib/learn/lessons/practice';
import type { DueReview } from '@/lib/learn/lessons/review';
import type { ListVideo, ListVideoPage, VideoCard } from '@/lib/learn/youtube/videos';
import type { ChannelSummary, PlaylistPage, Usage, VideoPage, VideoRow } from '@/lib/learn/youtube/load';

/**
 * The fifteen Learn pages that had no picture (plan #1602), each drawn by the
 * view its page hands its reads to, from fixtures shaped like the live rows.
 * One subject, Economics, runs through them, so a link on one page names
 * something another page shows.
 */

const NOW = new Date('2026-10-07T09:30:00Z');
const ZONE = 'Europe/London';
const SUBJECT = { id: '5e000000-0000-4000-8000-000000000001', name: 'Economics', note: null, createdAt: '2026-08-02T10:00:00Z' };

// ---- One idea --------------------------------------------------------------

function concept(over: Partial<Concept> & Pick<Concept, 'id' | 'name' | 'claim'>): Concept {
  return {
    claimOriginal: null,
    claimRewrittenAt: null,
    basis: 'Named in the chain laid out for "Why do prices rise when supply falls?"',
    kind: 'consequence',
    state: 'unknown',
    established: 'inferred',
    misconception: null,
    mastery: [],
    testedAt: null,
    declaredAt: null,
    catalogueSearchedAt: null,
    ...over,
  };
}

const elasticity = concept({
  id: 'c0000000-0000-4000-8000-000000000003',
  name: 'Price elasticity of demand',
  claim:
    'How far the quantity people buy moves when the price moves, measured in percentages so that goods sold in different units can be compared.',
  claimOriginal: 'How far the quantity bought moves when the price moves, in percentage terms.',
  claimRewrittenAt: '2026-09-21T18:12:00Z',
  basis: 'Named in the chain laid out for "Why do prices rise when supply falls?", as the step between a shift in supply and how far the price moves.',
  state: 'shaky',
  established: 'tested',
  mastery: [
    'Says why the measure uses percentages rather than units',
    'Tells an elastic good from an inelastic one from an example',
    'Predicts which way total spending moves when the price rises',
  ],
  testedAt: '2026-10-03T08:40:00Z',
  catalogueSearchedAt: '2026-10-01T12:00:00Z',
});

const supplyDemand = concept({
  id: 'c0000000-0000-4000-8000-000000000002',
  name: 'Supply and demand',
  claim: 'A competitive market price settles where the quantity buyers want meets what sellers offer.',
  kind: 'threshold',
  state: 'known',
  established: 'tested',
  testedAt: '2026-09-28T09:00:00Z',
});

const surplus = concept({
  id: 'c0000000-0000-4000-8000-000000000004',
  name: 'Consumer surplus',
  claim: 'What buyers would have paid above the price, summed over every buyer.',
});

const taxIncidence = concept({
  id: 'c0000000-0000-4000-8000-000000000005',
  name: 'Tax incidence',
  claim: 'Who really pays a tax depends on which side of the market can least easily walk away, not on who hands the money over.',
});

const conceptProbes: ProbeRow[] = [
  {
    id: 'p1',
    conceptId: elasticity.id,
    question:
      'A café raises the price of a flat white from £3.20 to £3.60 and sells a tenth fewer cups.\n\nIs demand for its coffee elastic or inelastic at that price, and what happened to what it took in?',
    options: null,
    correctIndex: null,
    reason: null,
    chosenIndex: null,
    expected: 'Inelastic: a 12.5% rise in price lost 10% of the cups, so takings went up.',
    response: 'Elastic, because people stopped buying',
    responseCorrect: false,
    gradeReason: 'Fewer cups were sold, but by a smaller share than the price rose, which is what inelastic means.',
    rung: 'apply',
    weight: 1,
    masteryCheck: 'Tells an elastic good from an inelastic one from an example',
    askedAt: '2026-10-03T08:38:00Z',
  },
  {
    id: 'p2',
    conceptId: elasticity.id,
    question: 'Why is elasticity measured in percentages?',
    options: [
      'So goods sold in different units can be compared',
      'Because prices are always quoted as percentages',
      'To make the number come out between 0 and 1',
    ],
    correctIndex: 0,
    reason: 'A change of one unit means something different for litres of milk and for cars; percentages remove the unit.',
    chosenIndex: 0,
    expected: null,
    response: null,
    responseCorrect: null,
    gradeReason: null,
    rung: 'recognise',
    weight: 1,
    masteryCheck: 'Says why the measure uses percentages rather than units',
    askedAt: '2026-09-14T19:02:00Z',
  },
];

const conceptMaterial: ClaimMaterialView = {
  absence: null,
  material: [
    {
      segmentId: 'seg1',
      ordinal: 4,
      basis: 'Works two examples, petrol and restaurant meals, and shows takings rising for one and falling for the other.',
      confidence: 'verified',
      model: 'claude-sonnet',
      shape: 'clip',
      where: '12:04–18:30',
      lengthChars: 5200,
      tStartSeconds: 724,
      tEndSeconds: 1110,
      item: {
        id: 'item1',
        title: 'Elasticity and total revenue',
        author: 'Marginal Revolution University',
        kind: 'video',
        canonicalUrl: 'https://www.youtube.com/watch?v=example1',
        durationSeconds: 1500,
      },
    },
    {
      segmentId: 'seg2',
      ordinal: 2,
      basis: 'States the definition and why the measure is a ratio of percentages.',
      confidence: 'unverified',
      model: null,
      shape: 'section',
      where: 'Price elasticity of demand',
      lengthChars: 3100,
      tStartSeconds: null,
      tEndSeconds: null,
      item: {
        id: 'item2',
        title: 'Principles of Economics, chapter 5: Elasticity',
        author: 'OpenStax',
        kind: 'article',
        canonicalUrl: 'https://openstax.org/books/principles-economics-3e/pages/5-1',
        durationSeconds: null,
      },
    },
  ],
};

const conceptNotes: CardNote[] = [
  {
    id: 'note1',
    body: 'Petrol is the example that makes it click: you still drive to work when it goes up 10p.',
    createdAt: '2026-10-02T21:15:00Z',
    cardId: 'card1',
    conceptId: elasticity.id,
  },
];

export function LearnConceptSurface() {
  return (
    <ConceptPageView
      view={{
        subject: SUBJECT,
        concept: elasticity,
        prerequisites: [supplyDemand],
        dependents: [surplus, taxIncidence],
        refersTo: [],
        referredToBy: [
          {
            concept: taxIncidence,
            basis: 'The side with less elastic demand ends up paying more of the tax.',
          },
        ],
      }}
      probes={conceptProbes}
      opening={{
        id: 'o1',
        position: 3,
        claimName: 'Price elasticity of demand',
        claim: elasticity.claim,
        question: 'If a price goes up and people buy a little less, does the seller take in more or less money?',
        expected: 'More, when the quantity falls by a smaller share than the price rose.',
        response: 'Less',
        outcome: 'wrong',
      }}
      material={conceptMaterial}
      notes={conceptNotes}
      timezone={ZONE}
      now={NOW}
    />
  );
}

// ---- Reading lists -----------------------------------------------------------

function track(over: Partial<TrackSummary> & Pick<TrackSummary, 'id' | 'title'>): TrackSummary {
  return {
    question: null,
    status: 'active',
    createdAt: '2026-09-20T10:00:00Z',
    branchedFrom: null,
    progress: { read: 0, remaining: 0, abandoned: 0, fraction: 0 },
    matches: [],
    ...over,
  };
}

const progress = (read: number, remaining: number) => ({
  read,
  remaining,
  abandoned: 0,
  fraction: read + remaining === 0 ? 0 : read / (read + remaining),
});

const listRows: NestedTrack[] = [
  {
    track: track({
      id: 't1',
      title: 'Economics',
      question: 'Why do prices rise when supply falls, and who ends up paying for it?',
    }),
    depth: 0,
    rolled: progress(4, 13),
  },
  {
    track: track({ id: 't2', title: 'Elasticity and who pays a tax', branchedFrom: 't1', progress: progress(3, 5) }),
    depth: 1,
    rolled: progress(3, 5),
  },
  {
    track: track({ id: 't3', title: 'How central banks set interest rates', branchedFrom: 't1', progress: progress(1, 8) }),
    depth: 1,
    rolled: progress(1, 8),
  },
  {
    track: track({
      id: 't4',
      title: 'The Peloponnesian War, from Thucydides to the modern accounts of the plague at Athens',
      question: 'What did Thucydides see that later historians missed?',
      progress: progress(0, 6),
    }),
    depth: 0,
    rolled: progress(0, 6),
  },
  {
    track: track({ id: 't5', title: 'Sourdough', progress: progress(5, 0) }),
    depth: 0,
    rolled: progress(5, 0),
  },
];

export function LearnListsSurface() {
  return <ListsView rows={listRows} search="" />;
}

// ---- New reading list, new quiz -----------------------------------------------

export function LearnNewSurface() {
  return <NewTrackPage />;
}

export function LearnQuizNewSurface() {
  return <NewQuizPage />;
}

// ---- Before you start: the opening questions, answered ------------------------

const sweep: OpeningSweep = {
  id: 'sw1',
  asked: 'Why do prices rise when supply falls?',
  subjectName: 'Economics',
  subjectId: null,
  questions: [
    {
      id: 'q1',
      position: 1,
      claimName: 'Opportunity cost',
      claim: 'The cost of a choice is the best alternative given up.',
      question: 'You spend Saturday working a shift for £80 instead of going to a gig you had a free ticket for. What did the shift cost you?',
      expected: 'The gig: the best thing given up, not money.',
      response: 'The gig',
      outcome: 'right',
    },
    {
      id: 'q2',
      position: 2,
      claimName: 'Supply and demand',
      claim: 'A competitive price settles where what buyers want meets what sellers offer.',
      question: 'A frost destroys half the orange crop. What happens to the price of orange juice, and why?',
      expected: 'It rises: less is offered at every price, so the price climbs until buyers want only what is left.',
      response: 'It goes up because there are fewer oranges',
      outcome: 'right',
    },
    {
      id: 'q3',
      position: 3,
      claimName: 'Price elasticity of demand',
      claim: 'How far the quantity bought moves when the price moves, in percentages.',
      question: 'If a price goes up and people buy a little less, does the seller take in more or less money?',
      expected: 'More, when the quantity falls by a smaller share than the price rose.',
      response: 'Less',
      outcome: 'wrong',
    },
    {
      id: 'q4',
      position: 4,
      claimName: 'Tax incidence',
      claim: 'Who pays a tax depends on which side can least easily walk away.',
      question: 'A tax on cigarettes is collected from shops. Who ends up paying most of it?',
      expected: 'Smokers, because their demand barely moves with the price.',
      response: null,
      outcome: 'skipped',
    },
  ],
};

export function LearnOpeningSurface() {
  return <OpeningView sweep={sweep} />;
}

// ---- A quiz, part answered, and the question you are on -----------------------

const quiz: Quiz = {
  id: 'qz1',
  title: 'Microeconomics midterm',
  preparingFor: 'the ECON 101 midterm on Thursday',
  status: 'part_done',
  createdAt: '2026-10-05T19:00:00Z',
  sources: [
    { id: 's1', position: 1, noteId: 'n1', body: null },
    { id: 's2', position: 2, noteId: null, body: 'Lecture 6 handout' },
    { id: 's3', position: 3, noteId: 'n-gone', body: null },
  ],
  questions: [
    {
      id: 'qq1',
      position: 1,
      sourceId: 's1',
      question: 'What does it mean for demand to be inelastic?',
      expected: 'The quantity bought changes by a smaller percentage than the price did.',
      response: 'People keep buying about the same amount when the price changes',
      outcome: 'right',
    },
    {
      id: 'qq2',
      position: 2,
      sourceId: 's2',
      question: 'Why does a price ceiling below the market price cause a shortage?',
      expected: 'At the capped price buyers want more than sellers are willing to offer, and the price cannot rise to close the gap.',
      response: 'Because sellers stop selling',
      outcome: 'wrong',
    },
    {
      id: 'qq3',
      position: 3,
      sourceId: 's2',
      question: 'Name one thing that shifts the demand curve rather than moving along it.',
      expected: 'A change in income, tastes, the price of a substitute or complement, or expectations.',
      response: null,
      outcome: 'skipped',
    },
    {
      id: 'qq4',
      position: 4,
      sourceId: 's1',
      question: 'When a firm raises its price and its total revenue falls, what does that say about demand for its product?',
      expected: 'Demand is elastic at that price.',
      response: null,
      outcome: null,
    },
    {
      id: 'qq5',
      position: 5,
      sourceId: 's3',
      question: 'What is consumer surplus?',
      expected: 'What buyers would have paid above the price, summed over every buyer.',
      response: null,
      outcome: null,
    },
  ],
};

const quizMaterial: QuizMaterial[] = [
  { sourceId: 's1', position: 1, label: 'ECON 101 · Elasticity', text: '…', href: '/vault/n/School/ECON%20101/Elasticity' },
  { sourceId: 's2', position: 2, label: '“Lecture 6 handout: price controls, ceilings and floors, and who gains…”', text: '…', href: null },
  { sourceId: 's3', position: 3, label: 'A note that has since been deleted', text: null, href: null },
];

export function LearnQuizSurface() {
  return <QuizView quiz={quiz} material={quizMaterial} />;
}

export function LearnQuizTakeSurface() {
  return <TakeQuizView quiz={quiz} current={quiz.questions[3]} />;
}

// ---- One reading ---------------------------------------------------------------

const reading: ReadingDetail = {
  id: 'r1',
  position: 2,
  status: 'reading',
  subject: 'Principles of Economics, chapter 5: Elasticity',
  title: null,
  why: 'The clearest statement of why takings rise when demand is inelastic, which is the step the opening questions caught you on.',
  note: 'Total revenue moves with the price when demand is inelastic and against it when elastic. Petrol, cigarettes, salt are inelastic; restaurant meals are not.',
  locatorKind: 'section',
  locatorLabel: '5.1 Price Elasticity of Demand and Price Elasticity of Supply',
  locatorBasis: 'Found verbatim in the fetched page: the section heading and its first paragraph match.',
  locatorConfidence: 'verified',
  openUrl: 'https://openstax.org/books/principles-economics-3e/pages/5-1',
  textAnchor: null,
  pageFrom: 101,
  pageTo: 108,
  tStartSeconds: null,
  tEndSeconds: null,
  finishedAt: null,
  readNowAt: '2026-10-06T08:00:00Z',
  conceptId: elasticity.id,
  newsStoryId: null,
  source: {
    id: 'src1',
    title: 'Principles of Economics 3e',
    author: 'Steven A. Greenlaw, David Shapiro, Daniel MacDonald',
    kind: 'book',
    year: 2022,
    canonicalUrl: 'https://openstax.org/details/books/principles-economics-3e',
    access: 'open',
    priceCents: null,
    pageCount: 812,
  },
  trackId: 't2',
  trackTitle: 'Elasticity and who pays a tax',
  trackQuestion: null,
};

export function LearnReadingSurface() {
  return (
    <ReadingView
      reading={reading}
      subjects={[SUBJECT, { id: 's-hist', name: 'Ancient history', note: null, createdAt: '2026-07-01T10:00:00Z' }]}
      alreadyRead={null}
      origin={null}
    />
  );
}

// ---- One piece of a learning goal's plan ------------------------------------------

const piecePage: PiecePage = {
  piece: { id: 'pc2', ordinal: 2, title: 'When a price rise brings in more money', passedAt: null },
  subject: { id: SUBJECT.id, name: SUBJECT.name },
  unit: {
    id: 'u1',
    ordinal: 2,
    title: 'Elasticity',
    outcome: 'You can say, from a price change and a sales figure, whether takings went up and why.',
  },
  siblings: [
    { id: 'pc1', ordinal: 1, title: 'Measuring how far buyers move', passed: true },
    { id: 'pc2', ordinal: 2, title: 'When a price rise brings in more money', passed: false },
    { id: 'pc3', ordinal: 3, title: 'Who pays a tax', passed: false },
  ],
  ideas: [
    {
      conceptId: elasticity.id,
      name: 'Price elasticity of demand',
      claim: elasticity.claim,
      dropped: null,
      lesson: {
        takeaway: 'When buyers barely react to a price rise, the seller takes in more; when they walk away, it takes in less.',
        context: 'This is the question every café, train company and finance minister is asking when they set a price.',
        hook: null,
        summary:
          'Elasticity compares the percentage change in quantity with the percentage change in price. Below one, demand is inelastic and revenue rises with the price; above one, it is elastic and revenue falls.',
        example:
          'A café puts its flat white up from £3.20 to £3.60, 12.5%, and sells 10% fewer. It now takes £324 from 90 cups where it took £320 from 100.',
        question: 'Petrol goes up 10% and people buy 2% less. Does the government’s fuel duty take go up or down?',
        answer: 'Up: demand for petrol is inelastic, so the quantity falls by much less than the price rose.',
      },
    },
  ],
  check: null,
};

const practice: PracticeView = {
  id: 'pr1',
  task: 'A cinema sells 400 tickets a night at £10. It tries £12 for a month and sells 360. Work out the elasticity and say whether it should keep the new price.',
  data: { columns: ['Price', 'Tickets a night'], rows: [['£10', '400'], ['£12', '360']] },
  figures: [
    { label: 'Elasticity', unit: null },
    { label: 'Takings at £12', unit: '£' },
  ],
  spreadsheetNote: null,
  worked: null,
  passed: false,
  latest: null,
};

const reviews: DueReview[] = [
  {
    conceptId: supplyDemand.id,
    name: 'Supply and demand',
    subjectId: SUBJECT.id,
    trackName: SUBJECT.name,
    pieceId: 'pc1',
    pieceTitle: 'Measuring how far buyers move',
    dueOn: '2026-10-07',
    open: null,
  },
];

export function LearnPieceSurface() {
  return (
    <PiecePageView
      page={piecePage}
      practice={practice}
      standing={{ practicePassed: false, checkPassed: false }}
      reviews={reviews}
    />
  );
}

// ---- Questions on a subject ---------------------------------------------------------

export function LearnProbeSurface() {
  return <ProbeView subject={SUBJECT} ideas={14} percent={38} namedConcept={null} />;
}

// ---- Videos ---------------------------------------------------------------------------

function listVideo(over: Partial<ListVideo> & Pick<ListVideo, 'videoId' | 'title'>): ListVideo {
  return {
    channel: 'Marginal Revolution University',
    durationSeconds: 540,
    addedAt: '2026-10-05T10:00:00Z',
    watchedAt: null,
    verdict: null,
    verdictBy: null,
    judgeVerdict: null,
    why: null,
    bestStartSeconds: null,
    bestEndSeconds: null,
    screenedAt: null,
    stretchCount: 0,
    foundFor: null,
    ...over,
  };
}

const videos: ListVideo[] = [
  listVideo({
    videoId: 'vid00000001',
    title: 'Elasticity and total revenue',
    durationSeconds: 1500,
    verdict: 'watch',
    verdictBy: 'judge',
    judgeVerdict: 'watch',
    why: 'Works two examples through to the takings, which is the step you are missing.',
    bestStartSeconds: 724,
    bestEndSeconds: 1110,
    screenedAt: '2026-10-05T12:00:00Z',
    foundFor: 'Economics',
  }),
  listVideo({
    videoId: 'vid00000002',
    title: 'Why the price of eggs doubled, and why it will not come back down as fast as it went up',
    channel: 'Planet Money',
    durationSeconds: 1260,
    addedAt: '2026-10-04T18:30:00Z',
    verdict: 'card',
    verdictBy: 'judge',
    judgeVerdict: 'card',
    why: 'One good point about supply shocks at 6:10; the rest is reporting.',
    screenedAt: '2026-10-04T20:00:00Z',
    stretchCount: 2,
  }),
  listVideo({
    videoId: 'vid00000003',
    title: 'Thucydides and the plague of Athens',
    channel: 'Fall of Civilizations',
    durationSeconds: 5400,
    addedAt: '2026-10-02T09:10:00Z',
    watchedAt: '2026-10-03T21:00:00Z',
    verdict: 'watch',
    verdictBy: 'you',
    judgeVerdict: 'skip',
    why: 'Nothing here serves a subject you are learning.',
    screenedAt: '2026-10-02T12:00:00Z',
  }),
  listVideo({
    videoId: 'vid00000004',
    title: '10 things you did not know about money',
    channel: 'Facts Daily',
    durationSeconds: 640,
    addedAt: '2026-09-30T07:45:00Z',
    verdict: 'skip',
    verdictBy: 'judge',
    judgeVerdict: 'skip',
    why: 'A list of trivia; nothing in it is an idea you are working on.',
    screenedAt: '2026-09-30T12:00:00Z',
  }),
  listVideo({
    videoId: 'vid00000005',
    title: 'Price controls',
    addedAt: '2026-10-07T07:00:00Z',
    screenedAt: '2026-10-07T08:00:00Z',
  }),
];

const channels: ChannelSummary[] = [
  {
    id: 'ch1',
    slug: 'marginal-revolution-university',
    name: 'Marginal Revolution University',
    handle: '@MarginalRevolutionUniversity',
    homeUrl: 'https://www.youtube.com/@MarginalRevolutionUniversity',
    autoTranscribe: true,
    lastListedAt: '2026-10-07T06:00:00Z',
    videos: 1284,
    playlists: 38,
  },
  {
    id: 'ch2',
    slug: 'fall-of-civilizations',
    name: 'Fall of Civilizations',
    handle: null,
    homeUrl: 'https://www.youtube.com/channel/UCexample',
    autoTranscribe: false,
    lastListedAt: '2026-10-06T06:00:00Z',
    videos: 21,
    playlists: 1,
  },
];

const usage: Usage = {
  credits: { allowance: 1000, used: 312, remaining: 688, resetsAt: new Date('2026-11-01T00:00:00Z') },
  outcomes: { fetched: 304, 'no-captions': 8 },
  recent: [],
  queue: { queued: 3, failed: 0, none: 8, fetched: 1204 },
};

export function LearnVideosSurface() {
  return (
    <VideosView
      all={videos}
      videos={videos}
      q={undefined}
      pile={null}
      cardCounts={new Map([['vid00000002', 2]])}
      clipCounts={new Map([['vid00000001', 3]])}
      progress="14 clips cut from 5 videos, 9 left to play. The next batch is cut tonight."
      clips={null}
      channels={channels}
      usage={usage}
      list={{ playlistId: 'PLexampleDashList', readAt: '2026-10-07T06:00:00Z', error: null, videos: 5 }}
      now={NOW.getTime()}
      open={undefined}
    />
  );
}

// ---- One video on your list -------------------------------------------------------------

/* A video id that YouTube embeds, so the player draws as it does on the page. */
const EMBEDDABLE = 'jNQXAC9IVRw';

const listVideoPage: ListVideoPage = {
  ...videos[1],
  videoId: EMBEDDABLE,
  itemId: 'item2',
  url: `https://www.youtube.com/watch?v=${EMBEDDABLE}`,
  description: null,
  chapters: [
    { startSeconds: 0, title: 'The shelves in March' },
    { startSeconds: 370, title: 'What a supply shock does to a price' },
    { startSeconds: 805, title: 'Why prices fall slower than they rise' },
  ],
  summary:
    'An outbreak of bird flu cut the number of laying hens by a fifth, and egg prices doubled within two months. The episode follows one farm and one wholesaler to show why the price moved so far for a modest fall in supply.',
  keyPoints: [
    'Demand for eggs barely moves with the price, so a small fall in supply moves the price a long way.',
    'Wholesalers pass rises on within days but cut prices only when competitors do.',
  ],
  summaryFrom: 'transcript',
  summarisedAt: '2026-10-04T21:00:00Z',
  transcriptState: 'fetched',
  leftPlaylistAt: null,
};

const videoCards: VideoCard[] = [
  {
    id: 'vc1',
    videoId: EMBEDDABLE,
    startSeconds: 370,
    endSeconds: 455,
    title: 'Price elasticity of demand',
    conceptId: elasticity.id,
    status: 'shown',
  },
  {
    id: 'vc2',
    videoId: EMBEDDABLE,
    startSeconds: 805,
    endSeconds: 890,
    title: 'Prices that rise fast and fall slowly',
    conceptId: null,
    status: 'written',
  },
];

export function LearnVideoSurface() {
  return (
    <ListVideoView
      video={listVideoPage}
      start={0}
      cards={videoCards}
      related={[
        { conceptId: elasticity.id, name: 'Price elasticity of demand', similarity: 0.82, subjectId: SUBJECT.id, subjectName: 'Economics' },
        { conceptId: supplyDemand.id, name: 'Supply and demand', similarity: 0.77, subjectId: SUBJECT.id, subjectName: 'Economics' },
      ]}
      relatedError={null}
    />
  );
}

// ---- The YouTube library: a channel, a playlist, a video ----------------------------------

function videoRow(over: Partial<VideoRow> & Pick<VideoRow, 'videoId' | 'title'>): VideoRow {
  return {
    itemId: `item-${over.videoId}`,
    url: `https://www.youtube.com/watch?v=${over.videoId}`,
    publishedAt: '2026-09-01',
    durationSeconds: 480,
    state: null,
    note: null,
    ...over,
  };
}

const libraryVideos: VideoRow[] = [
  videoRow({ videoId: 'mru00000001', title: 'Elasticity and total revenue', durationSeconds: 1500, publishedAt: '2026-09-30', state: 'fetched' }),
  videoRow({ videoId: 'mru00000002', title: 'Price ceilings: the US gas shortages of the 1970s', publishedAt: '2026-09-23', state: 'queued' }),
  videoRow({ videoId: 'mru00000003', title: 'Tax incidence: who pays?', publishedAt: '2026-09-16', state: 'failed', note: 'TranscriptAPI timed out' }),
  videoRow({ videoId: 'mru00000004', title: 'The deadweight loss of a tax', publishedAt: '2026-09-09', state: 'none' }),
  videoRow({ videoId: 'mru00000005', title: 'Consumer surplus, and what a demand curve tells you about how much people value a good', publishedAt: '2026-09-02' }),
];

export function LearnYoutubeChannelSurface() {
  return (
    <ChannelView
      slug={channels[0].slug}
      data={{
        channel: channels[0],
        playlists: [
          { itemId: 'pl1', playlistId: 'PL1', title: 'Principles of Economics: Microeconomics', url: 'https://www.youtube.com/playlist?list=PL1', videos: 112 },
          { itemId: 'pl2', playlistId: 'PL2', title: 'Development economics', url: 'https://www.youtube.com/playlist?list=PL2', videos: 46 },
          { itemId: 'pl3', playlistId: 'PL3', title: 'Office hours', url: 'https://www.youtube.com/playlist?list=PL3', videos: 9 },
        ],
        videos: libraryVideos,
        more: true,
      }}
      page={0}
      search=""
    />
  );
}

const playlistPage: PlaylistPage = {
  channel: { slug: channels[0].slug, name: channels[0].name },
  playlist: { itemId: 'pl1', playlistId: 'PL1', title: 'Principles of Economics: Microeconomics', url: 'https://www.youtube.com/playlist?list=PL1', videos: 5 },
  videos: libraryVideos,
};

export function LearnYoutubePlaylistSurface() {
  return <PlaylistView data={playlistPage} />;
}

const libraryVideo: VideoPage = {
  video: libraryVideos[0],
  description: null,
  channel: { slug: channels[0].slug, name: channels[0].name },
  segments: [
    { tStartSeconds: 0, tEndSeconds: 360, embedded: true },
    { tStartSeconds: 360, tEndSeconds: 724, embedded: true },
    { tStartSeconds: 724, tEndSeconds: 1110, embedded: false },
  ],
};

export function LearnYoutubeVideoSurface() {
  return (
    <LibraryVideoView
      data={libraryVideo}
      language="en"
      paragraphs={[
        {
          startSeconds: 0,
          text: 'Today we are going to look at what happens to a firm’s revenue when it raises its price. You might think the answer is obvious: a higher price means more money. But that is only half the story.',
        },
        {
          startSeconds: 64,
          text: 'Revenue is price times quantity. Raise the price and you get more on every unit, but you also sell fewer units. Which effect wins depends on how sensitive buyers are, and that sensitivity is what economists call elasticity.',
        },
        {
          startSeconds: 131,
          text: 'Take petrol. When the price goes up ten percent, people still need to get to work, so they buy only a little less. The higher price wins, and revenue goes up.',
        },
        {
          startSeconds: 198,
          text: 'Now take meals out. Put the price up ten percent and plenty of people cook at home instead. The lost customers win, and revenue goes down.',
        },
      ]}
      start={0}
      stop={null}
    />
  );
}
