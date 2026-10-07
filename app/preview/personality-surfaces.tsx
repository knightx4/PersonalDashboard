import { PageHeader } from '@/components/shell/page-header';
import { BigFiveTest } from '@/app/learn/know/personality/big-five-test';
import { OtherTests } from '@/app/learn/know/personality/other-tests';
import { PersonalitySection } from '@/app/learn/know/personality-section';
import { MODELS } from '@/lib/core/models';
import { IPIP_ITEM_COUNT } from '@/lib/learn/personality/ipip';
import type { BigFiveResult, PersonalityRead, TypedResult } from '@/lib/learn/personality/model';
import type { TraitThemes } from '@/lib/learn/personality/trait-themes';

/**
 * The Big Five test (plan #1632) in the surface gallery: the list with the
 * first few statements answered, and the scores of a kept result. Types
 * from other tests (plan #1633) sit beneath: two on the test, three on the
 * scores, and the compose form open on its own surface. Nothing here writes;
 * the save runs only once all fifty are answered or the form is sent.
 */

const TODAY = '2026-10-07';

function Header() {
  return (
    <PageHeader
      crumbs={[
        { label: 'Learn', href: '/learn' },
        { label: 'Know', href: '/learn/know' },
        { label: 'Personality test', href: '/learn/know/personality' },
      ]}
      title="Personality test"
    />
  );
}

const PART_ANSWERED: Array<number | null> = [
  4, 2, 5, 3, 4, 2, 5,
  ...Array<number | null>(IPIP_ITEM_COUNT - 7).fill(null),
];

const RESULT: BigFiveResult = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'big_five',
  testName: 'Big Five',
  takenAt: '2026-10-07',
  createdAt: '2026-10-07T18:20:00Z',
  note: null,
  read: null,
  readFailedAt: null,
  answers: Array(IPIP_ITEM_COUNT).fill(3),
  scores: {
    extraversion: 19,
    agreeableness: 38,
    conscientiousness: 33,
    emotional_stability: 24,
    intellect: 46,
  },
};

const TYPED: TypedResult[] = [
  {
    id: '00000000-0000-4000-8000-000000000011',
    kind: 'mbti',
    testName: 'Myers-Briggs',
    typedValue: 'INTJ',
    takenAt: '2024-03-14',
    createdAt: '2026-10-07T18:30:00Z',
    note: 'From the official assessment at work. I came out as INTP the first time, years ago.',
    read: null,
    readFailedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000012',
    kind: 'enneagram',
    testName: 'Enneagram',
    typedValue: '5w4',
    takenAt: '2025-11-02',
    createdAt: '2026-10-07T18:31:00Z',
    note: null,
    read: null,
    readFailedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000013',
    kind: 'other',
    testName: 'CliftonStrengths, the full thirty-four themes report from the team offsite',
    typedValue: 'Learner, Intellection, Strategic, Input, Achiever',
    takenAt: '2019-06-21',
    createdAt: '2026-10-07T18:32:00Z',
    note: null,
    read: null,
    readFailedAt: null,
  },
];

export function PersonalityTestSurface() {
  return (
    <>
      <Header />
      <BigFiveTest latest={null} initialAnswers={PART_ANSWERED} />
      <div className="mt-10">
        <OtherTests results={TYPED.slice(0, 2)} today={TODAY} />
      </div>
    </>
  );
}

export function PersonalityScoresSurface() {
  return (
    <>
      <Header />
      <BigFiveTest latest={RESULT} />
      <div className="mt-10">
        <OtherTests results={TYPED} today={TODAY} />
      </div>
    </>
  );
}

export function PersonalityAddTypeSurface() {
  return (
    <>
      <Header />
      <BigFiveTest latest={RESULT} />
      <div className="mt-10">
        <OtherTests results={TYPED.slice(1, 2)} today={TODAY} initialOpen />
      </div>
    </>
  );
}

/* The result on the Know page (plan #1634). */

const THEMES: TraitThemes = {
  extraversion: [
    { id: '00000000-0000-4000-8000-000000000101', name: 'Introversion' },
    { id: '00000000-0000-4000-8000-000000000102', name: 'Solitude and long walks' },
    { id: '00000000-0000-4000-8000-000000000103', name: 'Small talk' },
  ],
  agreeableness: [
    { id: '00000000-0000-4000-8000-000000000104', name: 'Friendship' },
    { id: '00000000-0000-4000-8000-000000000105', name: 'Helping my brother through his first year at university' },
    { id: '00000000-0000-4000-8000-000000000106', name: 'Trust' },
  ],
  conscientiousness: [
    { id: '00000000-0000-4000-8000-000000000107', name: 'Habits' },
    { id: '00000000-0000-4000-8000-000000000108', name: 'Weekly review' },
  ],
  emotional_stability: [
    { id: '00000000-0000-4000-8000-000000000109', name: 'Anxiety' },
    { id: '00000000-0000-4000-8000-000000000110', name: 'Stoicism' },
    { id: '00000000-0000-4000-8000-000000000111', name: 'Sleep' },
  ],
  intellect: [],
};

const EARLIER: BigFiveResult[] = [
  {
    ...RESULT,
    id: '00000000-0000-4000-8000-000000000002',
    takenAt: '2026-04-12',
    createdAt: '2026-04-12T09:00:00Z',
    scores: {
      extraversion: 21,
      agreeableness: 36,
      conscientiousness: 29,
      emotional_stability: 22,
      intellect: 45,
    },
  },
];

/* Dash's read of the result against the notes (plan #1635). */

/** The moment the gallery's page is drawn: ninety seconds after the reading surface's save. */
const NOW = Date.parse('2026-10-07T18:40:00Z');

const READ: PersonalityRead = {
  model: MODELS.learnPersonalityRead,
  at: '2026-10-07T18:21:10Z',
  points: [
    {
      stance: 'clashes',
      text: 'The test puts your Extraversion low, at 23, but you write that long dinners with friends leave you buzzing for days and that you go looking for them most weekends.',
      note: {
        id: '00000000-0000-4000-8000-000000000201',
        title: 'On socialising and conversation',
        path: 'Me/On socialising and conversation.md',
      },
    },
    {
      stance: 'clashes',
      text: 'Conscientiousness sits near the middle, while your note says you drop most plans within a week and only finish what has a deadline on it.',
      note: {
        id: '00000000-0000-4000-8000-000000000202',
        title: 'Notes to self',
        path: 'Me/Notes to self.md',
      },
    },
    {
      stance: 'agrees',
      text: 'Intellect is your highest trait, and the note opens with reading philosophy late at night and keeping three books going at once.',
      note: { id: '00000000-0000-4000-8000-000000000203', title: 'About me', path: 'Me/About me.md' },
    },
    {
      stance: 'agrees',
      text: 'Low Emotional stability matches what you wrote about lying awake replaying a conversation and rehearsing what you should have said.',
      note: {
        id: '00000000-0000-4000-8000-000000000204',
        title: 'Why I keep a list of the books I will probably never finish, and why that is fine',
        path: 'Ideas/Why I keep a list of the books I will probably never finish, and why that is fine.md',
      },
    },
  ],
};

const TYPED_READ: TypedResult[] = [
  {
    ...TYPED[0]!,
    read: {
      model: MODELS.learnPersonalityRead,
      at: '2026-10-07T18:31:40Z',
      points: [
        {
          stance: 'agrees',
          text: 'INTJ’s preference for working alone fits your note on doing your best thinking on long solo walks.',
          note: {
            id: '00000000-0000-4000-8000-000000000205',
            title: 'Walking',
            path: 'Bulk/Walking.md',
          },
        },
      ],
    },
  },
  TYPED[1]!,
];

export function KnowPersonalitySurface() {
  return (
    <PersonalitySection
      latest={{ ...RESULT, read: READ }}
      earlier={EARLIER}
      typed={TYPED_READ}
      themes={THEMES}
      now={NOW}
    />
  );
}

/* Straight after saving: the read is still running. */
export function KnowPersonalityReadingSurface() {
  return (
    <PersonalitySection
      latest={{ ...RESULT, createdAt: '2026-10-07T18:38:30Z' }}
      earlier={[]}
      typed={[]}
      themes={THEMES}
      now={NOW}
    />
  );
}

export function KnowPersonalityEmptySurface() {
  return <PersonalitySection latest={null} earlier={[]} typed={[]} themes={null} now={NOW} />;
}
