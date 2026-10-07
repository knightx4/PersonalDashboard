import { PageHeader } from '@/components/shell/page-header';
import { BigFiveTest } from '@/app/learn/know/personality/big-five-test';
import { IPIP_ITEM_COUNT } from '@/lib/learn/personality/ipip';
import type { BigFiveResult } from '@/lib/learn/personality/model';

/**
 * The Big Five test (plan #1632) in the surface gallery: the list with the
 * first few statements answered, and the scores of a kept result. Nothing
 * here writes; the save runs only once all fifty are answered.
 */

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

export function PersonalityTestSurface() {
  return (
    <>
      <Header />
      <BigFiveTest latest={null} initialAnswers={PART_ANSWERED} />
    </>
  );
}

export function PersonalityScoresSurface() {
  return (
    <>
      <Header />
      <BigFiveTest latest={RESULT} />
    </>
  );
}
