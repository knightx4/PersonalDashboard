'use client';

import { CourseCheck, FromCoursesForm } from '@/app/learn/know/from-courses-form';
import type { ProposedChain } from '@/lib/learn/graph/chain-payload';
import type { CourseRead } from '@/lib/learn/graph/course-reads';
import { educationGroups } from './education-fixtures';

/**
 * The courses fold on Learn's Tracks page (plan #1391), wrapped on the client
 * side of the boundary because the check screen takes callbacks.
 */

const TRACKS = [
  { id: 's-econ', name: 'Economics' },
  { id: 's-stats', name: 'Statistics' },
];

const READS: Record<string, CourseRead> = {
  c3: { subject: TRACKS[0], conceptsAdded: 6, readAt: '2026-09-30T10:00:00Z' },
  c7: { subject: null, conceptsAdded: 4, readAt: '2026-09-30T11:00:00Z' },
};

const BASIS = 'From ECON 101, Principles of Economics I: Microeconomics, Winter 2018, grade A.';

const CHAIN: ProposedChain = {
  subject: 'Economics',
  goalConcept: 'Consumer surplus',
  nodes: [
    {
      name: 'Opportunity cost',
      claim: 'The cost of a choice is the best alternative given up, not the money spent.',
      basis: BASIS,
      mastery: [],
      kind: 'threshold',
      existingId: null,
    },
    {
      name: 'Supply and demand',
      claim:
        'A competitive market price settles where the quantity buyers want meets what sellers offer.',
      basis: BASIS,
      mastery: [],
      kind: 'threshold',
      existingId: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d',
    },
    {
      name: 'Price elasticity of demand',
      claim: 'How far the quantity bought moves when the price moves, in percentage terms.',
      basis: BASIS,
      mastery: [],
      kind: 'consequence',
      existingId: null,
    },
    {
      name: 'Consumer surplus',
      claim: 'What buyers would have paid above the price, summed over every buyer.',
      basis: BASIS,
      mastery: [],
      kind: 'consequence',
      existingId: null,
    },
  ],
  edges: [
    { prerequisite: 'Opportunity cost', dependent: 'Supply and demand', basis: 'Builds on it.' },
    { prerequisite: 'Supply and demand', dependent: 'Price elasticity of demand', basis: 'Builds on it.' },
    { prerequisite: 'Supply and demand', dependent: 'Consumer surplus', basis: 'Builds on it.' },
  ],
  mentions: [],
  joined: 1,
  dropped: [],
};

export function LearnCoursesListPreview() {
  return (
    <FromCoursesForm
      groups={educationGroups.filter((g) => g.terms.length > 0)}
      reads={READS}
      tracks={TRACKS}
    />
  );
}

export function LearnCoursesEmptyPreview() {
  return <FromCoursesForm groups={[]} reads={{}} tracks={TRACKS} />;
}

export function LearnCourseCheckPreview() {
  return (
    <CourseCheck
      course={{
        id: 'c3',
        label: 'ECON 101, Principles of Economics I: Microeconomics, Winter 2018, grade A',
      }}
      chain={CHAIN}
      subjectId="s-econ"
      tracks={TRACKS}
      propose={() => {}}
      onBack={() => {}}
    />
  );
}
