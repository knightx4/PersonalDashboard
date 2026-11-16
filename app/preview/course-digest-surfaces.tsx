'use client';

import { BuildView } from '@/app/learn/courses/[id]/build-view';
import { CourseView } from '@/app/learn/courses/[id]/course-view';
import { LessonView } from '@/app/learn/courses/[id]/l/[key]/lesson-view';
import { CoursesView } from '@/app/learn/courses/courses-view';
import { freshSteps } from '@/lib/learn/courses/build';
import { COURSE_CATALOGUE } from '@/lib/learn/courses/catalogue';
import { checkDigest, checkLectures, type Digest, type Lecture } from '@/lib/learn/courses/digest';
import { afterStep, findStep } from '@/lib/learn/courses/plan';
import type { Course } from '@/lib/learn/courses/store';
import fixture from './course-digest-fixture.json';

/**
 * Gallery fixtures for Learn's Courses tab (learn 0194): the list with one
 * course built and one building, a build part way through, a built course on
 * its plan and on its lectures, and one step. The digest is a cut of a real
 * one, MIT 18.S096, so the surfaces carry real lecture numbers and
 * timestamps: its opening stage, the three branches that follow it, and the
 * fork inside the first of them.
 */

// The fixture is the file a session saves, so it goes through the same check
// the save does: times become seconds and each step's minutes are worked out.
const listed = checkLectures(fixture.lectures);
const lectures: Lecture[] = listed.ok ? listed.lectures : [];
const checked = checkDigest(fixture.digest, lectures);
if (!checked.ok)
  throw new Error(`The course fixture does not check: ${checked.problems.join(' ')}`);
const digest: Digest = checked.digest;

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
    pathMinutes: 520,
    watchMinutes: 240,
    share: 0.11,
    watch: 5,
    parts: 8,
    skim: 14,
    skip: 1,
  },
  progress: { clips: [], lessons: [digest.plan.stages[0].steps[0].key] },
  error: null,
  runUrl: null,
  requestedAt: '2026-11-16T06:00:00Z',
  takenAt: '2026-11-16T06:01:00Z',
  builtAt: '2026-11-16T07:10:00Z',
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

export function CourseDigestLecturesPreview() {
  return <CourseView course={READY} digest={digest} tab="lectures" />;
}

// The last step of the opening stage, so the foot shows the branches to choose between.
const LAST = digest.plan.stages[0].steps[digest.plan.stages[0].steps.length - 1].key;

export function CourseDigestLessonPreview() {
  return (
    <LessonView
      course={READY}
      placed={findStep(digest.plan, LAST)!}
      next={afterStep(digest.plan, LAST)}
    />
  );
}
