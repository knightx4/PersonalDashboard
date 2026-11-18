import { ClipPlayer } from '@/components/learn/clip-player';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card, CardSection } from '@/components/ui/card';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { Tabs } from '@/components/ui/tabs';
import { sectionSubject } from '@/lib/core/section-path';
import {
  clock,
  hasPlan,
  linkMoments,
  RATING_LABEL,
  type Digest,
  type Lecture,
  type Plan,
  type Rating,
  type Step,
} from '@/lib/learn/courses/digest';
import {
  afterNames,
  isOpen,
  mapLayout,
  nextStep,
  placedSteps,
  shortName,
} from '@/lib/learn/courses/plan';
import type { Course } from '@/lib/learn/courses/store';
import { hours } from '../format';
import { CourseMarkdown } from './course-markdown';
import { PlanMap, type MapStage } from './plan-map';

/**
 * A built course (docs/LEARN-DIGEST-SPEC.md). The header says what the series
 * was cut from and to. Three tabs. Lessons is the plan, and the thing to do:
 * a map of the stages, each under the stages it rests on, and beside it the
 * stage you pressed with its steps to take one after another. Big ideas is what to keep from the whole series. Lectures is every
 * video with a verdict, each playing in the page.
 *
 * Every timestamp is a link built from the lecture's stored video id
 * (linkMoments), never one a model typed, and it opens the lecture in the
 * Lectures tab at that moment.
 */

const TABS = [
  { id: 'plan', label: 'Lessons' },
  { id: 'ideas', label: 'Big ideas' },
  { id: 'lectures', label: 'Lectures' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Where a moment opens: the lecture's own row on the Lectures tab, playing from there. */
export function momentHref(courseId: string) {
  return (lecture: Lecture, start: number) =>
    `/learn/courses/${courseId}?tab=lectures&play=${lecture.code}&t=${start}#lecture-${lecture.code}`;
}

export function CourseView({
  course,
  digest,
  tab,
  play = null,
}: {
  course: Course;
  digest: Digest;
  tab: string | null;
  /** A lecture to open playing on the Lectures tab, and from which second. */
  play?: { code: string; start: number } | null;
}) {
  const open: TabId = TABS.some((item) => item.id === tab) ? (tab as TabId) : 'plan';
  const { runtimeMinutes = 0, videos = course.lectures.length } = course.totals;
  const text = (source: string) => linkMoments(source, course.lectures, momentHref(course.id));
  const plan = hasPlan(digest) ? digest.plan : null;
  const maths = digest.maths === true;
  const planMinutes = plan
    ? placedSteps(plan).reduce((sum, placed) => sum + placed.step.minutes, 0)
    : 0;

  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject('/learn/courses', 'Courses', {
          label: course.title,
          href: `/learn/courses/${course.id}`,
        })}
        title={course.title}
        description={
          plan
            ? `${hours(runtimeMinutes)} of lectures across ${videos} videos, cut to about ${hours(planMinutes)} of lessons`
            : `${videos} videos, ${hours(runtimeMinutes)}`
        }
      />
      <Tabs tabs={TABS} label="Course" compact />

      {open === 'plan' &&
        (plan ? (
          <PlanTab course={course} plan={plan} text={text} maths={maths} />
        ) : (
          <Card padding="dense">
            <p className="text-ui text-ink [overflow-wrap:anywhere]">
              This course was built before courses had a lesson plan. Its big ideas and its lectures
              are in the other two tabs.
            </p>
          </Card>
        ))}
      {open === 'ideas' && (
        <Card padding="none">
          <ol className="divide-y divide-border">
            {digest.ideas.map((idea, index) => (
              <li key={idea.title} className="card-pad-x row-pad space-y-1.5">
                <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">
                  <span className="tabular text-ink-muted">{index + 1}. </span>
                  {idea.title}
                </p>
                <CourseMarkdown
                  maths={maths}
                  markdown={text(idea.body)}
                  className="vault-prose prose-compact"
                />
              </li>
            ))}
          </ol>
        </Card>
      )}
      {open === 'lectures' && (
        <LecturesTab course={course} digest={digest} text={text} play={play} maths={maths} />
      )}

      <CardSection title="About this digest" fold="learn.course.about" defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-ui text-ink [overflow-wrap:anywhere]">{digest.madeFor}</p>
          <CourseMarkdown
            maths={maths}
            markdown={text(digest.intro)}
            className="vault-prose prose-compact prose-aside"
          />
        </div>
      </CardSection>
    </PageColumn>
  );
}

type Text = (source: string) => string;

/**
 * The plan: a line on how the course is laid out, then the map
 * (plan-map.tsx). The map is given only what it draws, a stage's steps by
 * title and what is in them, so the steps' own text stays on the server.
 */
function PlanTab({
  course,
  plan,
  text,
  maths,
}: {
  course: Course;
  plan: Plan;
  text: Text;
  maths: boolean;
}) {
  const done = new Set(course.progress.lessons);
  const steps = placedSteps(plan);
  const taken = steps.filter((placed) => done.has(placed.step.key)).length;
  const next = nextStep(plan, done);
  const has = (step: Step, type: string) => step.blocks.some((block) => block.type === type);

  const stages: MapStage[] = plan.stages.map((stage) => ({
    key: stage.key,
    short: shortName(stage),
    title: stage.title,
    about: stage.about,
    after: afterNames(plan, stage),
    open: isOpen(plan, stage, done),
    steps: stage.steps.map((step) => ({
      key: step.key,
      title: step.title,
      gain: step.gain ?? null,
      minutes: step.minutes,
      clips: step.blocks.filter((block) => block.type === 'clip').length,
      figure: has(step, 'figure'),
      reading: has(step, 'reading'),
      check: has(step, 'check'),
      done: done.has(step.key),
    })),
  }));

  return (
    <section className="space-y-4">
      {plan.intro && (
        <CourseMarkdown
          maths={maths}
          markdown={text(plan.intro)}
          className="vault-prose prose-compact max-w-prose"
        />
      )}
      {taken > 0 && (
        <p className="tabular text-small text-ink-muted">
          {next
            ? `${taken} of ${steps.length} steps done across the whole course`
            : 'Every step of the course is done.'}
        </p>
      )}
      <PlanMap
        courseId={course.id}
        stages={stages}
        layout={mapLayout(plan)}
        nextStage={next?.stage.key ?? null}
      />
    </section>
  );
}

const RATING_TONE: Record<Rating, ChipTone> = {
  watch: 'accent',
  parts: 'positive',
  skim: 'neutral',
  skip: 'neutral',
};

function LecturesTab({
  course,
  digest,
  text,
  play,
  maths,
}: {
  course: Course;
  digest: Digest;
  text: Text;
  maths: boolean;
  play: { code: string; start: number } | null;
}) {
  const rated = new Map(digest.ratings.rows.map((row) => [row.code, row]));
  return (
    <section className="space-y-3">
      {digest.ratings.intro && (
        <CourseMarkdown
          maths={maths}
          markdown={text(digest.ratings.intro)}
          className="vault-prose prose-compact prose-aside"
        />
      )}
      <Card padding="none">
        <ul className="divide-y divide-border">
          {course.lectures.map((lecture) => (
            <LectureRow
              key={lecture.code}
              lecture={lecture}
              row={rated.get(lecture.code)}
              text={text}
              playFrom={play?.code === lecture.code ? play.start : null}
              maths={maths}
            />
          ))}
        </ul>
      </Card>
      {digest.errors.rows.length > 0 && (
        <CardSection
          title="What the lecturers got wrong"
          fold="learn.course.errors"
          defaultOpen={false}
          meta={digest.errors.rows.length}
        >
          <ul className="space-y-4">
            {digest.errors.rows.map((row, index) => (
              <li key={index} className="space-y-1">
                <CourseMarkdown
                  maths={maths}
                  markdown={text(`At ${row.where}`)}
                  className="vault-prose prose-compact prose-aside"
                />
                <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">Said: {row.said}</p>
                <CourseMarkdown
                  maths={maths}
                  markdown={text(row.correction)}
                  className="vault-prose prose-compact"
                />
              </li>
            ))}
          </ul>
        </CardSection>
      )}
    </section>
  );
}

function LectureRow({
  lecture,
  row,
  text,
  playFrom,
  maths,
}: {
  lecture: Lecture;
  row: Digest['ratings']['rows'][number] | undefined;
  text: Text;
  maths: boolean;
  /** Set when a moment's link opened this lecture: the player is up, at that second. */
  playFrom: number | null;
}) {
  return (
    <li id={`lecture-${lecture.code}`} className="card-pad-x row-pad scroll-mt-24 space-y-2">
      <div className="flex items-start gap-3">
        <span className="tabular w-8 shrink-0 text-small text-ink-muted">{lecture.code}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
            {lecture.title}
          </span>
          <span className="tabular block text-small text-ink-muted [overflow-wrap:anywhere]">
            {clock(lecture.durationSeconds)}
            {lecture.speaker ? ` · ${lecture.speaker}` : ''}
          </span>
        </span>
        {row && <Chip tone={RATING_TONE[row.rating]}>{RATING_LABEL[row.rating]}</Chip>}
      </div>
      {row && (
        <div className="space-y-1 pl-11">
          {row.watch && (
            <CourseMarkdown
              maths={maths}
              // Led by a word so a verdict that is only a timestamp still reads as a line of prose.
              markdown={text(`Watch ${row.watch}`)}
              className="vault-prose prose-compact prose-aside"
            />
          )}
          <CourseMarkdown
            maths={maths}
            markdown={text(row.why)}
            className="vault-prose prose-compact prose-aside"
          />
        </div>
      )}
      <ClipPlayer
        key={playFrom ?? 'whole'}
        videoId={lecture.videoId}
        title={
          playFrom === null ? 'The whole lecture, here in the page' : `From ${clock(playFrom)}`
        }
        start={playFrom}
        deferred={playFrom === null}
        className="pl-11"
      />
    </li>
  );
}
