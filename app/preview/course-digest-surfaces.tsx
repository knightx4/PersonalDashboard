'use client';

import { BuildView } from '@/app/learn/courses/[id]/build-view';
import { CourseView } from '@/app/learn/courses/[id]/course-view';
import { LessonView } from '@/app/learn/courses/[id]/l/[key]/lesson-view';
import { CoursesView } from '@/app/learn/courses/courses-view';
import { freshSteps } from '@/lib/learn/courses/build';
import { COURSE_CATALOGUE } from '@/lib/learn/courses/catalogue';
import type { Digest, Lecture } from '@/lib/learn/courses/digest';
import { afterStep, findStep } from '@/lib/learn/courses/plan';
import type { Course } from '@/lib/learn/courses/store';
import fixture from './course-digest-fixture.json';

/**
 * Gallery fixtures for Learn's Courses tab (learn 0194): the list with one
 * course built and one building, a build part way through, a built course on
 * its map before a step is taken and with a branch under way, its lectures,
 * and a step in the middle of a stage and at the end of one. The digest is a
 * real one, MIT 18.S096, as the save keeps it: every stage and step, with
 * the steps' own text kept for the first stage alone, since that is the only
 * stage a step surface opens.
 */

const lectures = fixture.lectures as Lecture[];
const digest = fixture.digest as Digest;
const [OPENING, RISK] = digest.plan.stages;

const READY: Course = {
  id: '00000000-0000-4000-8000-0000000c0001',
  title: 'MIT Quantitative Finance, Condensed',
  provider: 'MIT OpenCourseWare',
  sourceUrl: null,
  about:
    '18.S096 Topics in Mathematics with Applications in Finance (Fall 2013), plus four 2024 guest lectures.',
  goal: 'See how a sell-side quant desk measures risk and prices by replication.',
  budgetMinutes: 240,
  catalogueKey: 'mit-18s096-2013',
  status: 'ready',
  steps: [],
  totals: {
    videos: 28,
    runtimeMinutes: 2202,
    pathMinutes: 301,
    watchMinutes: 239,
    stages: 9,
    steps: 39,
    share: 0.11,
    watch: 5,
    parts: 8,
    skim: 14,
    skip: 1,
  },
  progress: { clips: [], lessons: [] },
  error: null,
  runUrl: null,
  requestedAt: '2026-11-16T06:00:00Z',
  takenAt: '2026-11-16T06:01:00Z',
  builtAt: '2026-11-16T07:10:00Z',
  updatedAt: '2026-11-16T07:10:00Z',
  digest,
  lectures,
};

const BUILDING: Course = {
  ...READY,
  id: '00000000-0000-4000-8000-0000000c0002',
  title: 'Neural Networks: Zero to Hero',
  provider: 'Andrej Karpathy',
  goal: 'Understand how a language model works from the inside.',
  catalogueKey: 'karpathy-zero-to-hero',
  status: 'building',
  totals: { videos: 10, runtimeMinutes: 1161 },
  progress: { clips: [], lessons: [] },
  builtAt: null,
  digest: null,
  lectures: [],
  steps: freshSteps().map((step, index) =>
    index < 2
      ? {
          ...step,
          state: 'done' as const,
          detail: index === 0 ? '10 videos, 19:21:02' : '10 of 10',
        }
      : index === 2
        ? { ...step, state: 'running' as const, detail: '6 of 10' }
        : step,
  ),
};

export function CourseDigestListPreview() {
  const have = new Set([READY.catalogueKey, BUILDING.catalogueKey]);
  return (
    <CoursesView
      courses={[BUILDING, READY]}
      catalogue={COURSE_CATALOGUE.filter((course) => !have.has(course.key))}
    />
  );
}

export function CourseDigestBuildingPreview() {
  return <BuildView course={BUILDING} />;
}

export function CourseDigestPlanPreview() {
  return <CourseView course={READY} digest={digest} tab="plan" />;
}

// The opening stage finished and the first branch begun: the map shows the
// line walked, and opens on the branch under way.
const UNDER_WAY: Course = {
  ...READY,
  progress: {
    clips: [],
    lessons: [...OPENING.steps.map((step) => step.key), RISK.steps[0].key],
  },
};

export function CourseDigestPlanUnderWayPreview() {
  return <CourseView course={UNDER_WAY} digest={digest} tab="plan" />;
}

export function CourseDigestLecturesPreview() {
  return <CourseView course={READY} digest={digest} tab="lectures" />;
}

const stepProps = (course: Course, key: string) => ({
  course,
  placed: findStep(digest.plan, key)!,
  next: afterStep(digest.plan, key),
});

export function CourseDigestLessonPreview() {
  return <LessonView {...stepProps(READY, OPENING.steps[0].key)} />;
}

// The last step of the opening stage, so the foot offers the branches.
export function CourseDigestLessonBranchPreview() {
  const last = OPENING.steps[OPENING.steps.length - 1].key;
  const course: Course = {
    ...READY,
    progress: { clips: [], lessons: OPENING.steps.slice(0, -1).map((step) => step.key) },
  };
  return <LessonView {...stepProps(course, last)} />;
}
