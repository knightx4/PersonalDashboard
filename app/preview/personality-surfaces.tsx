import { PageHeader } from '@/components/shell/page-header';
import { BigFiveTest } from '@/app/learn/know/personality/big-five-test';
import { OtherTests } from '@/app/learn/know/personality/other-tests';
import { IPIP_ITEM_COUNT } from '@/lib/learn/personality/ipip';
import type { BigFiveResult, TypedResult } from '@/lib/learn/personality/model';

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
