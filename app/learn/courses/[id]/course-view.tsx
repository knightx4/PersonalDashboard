import Link from '@/components/ui/link';
import { ArrowDown, Check } from 'lucide-react';
import { ClipPlayer } from '@/components/learn/clip-player';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { Markdown } from '@/components/ui/markdown';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
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
  type Stage,
  type Step,
} from '@/lib/learn/courses/digest';
import { afterTitles, isOpen, nextStep, placedSteps, stageRows } from '@/lib/learn/courses/plan';
import type { Course } from '@/lib/learn/courses/store';
import { hours } from '../format';

/**
 * A built course (docs/LEARN-DIGEST-SPEC.md). The header says what the series
 * was cut from and to. Three tabs. Lessons is the plan, and the thing to do:
 * the stages down the page in the order the ideas rest on each other, side by
 * side where the course branches, each a list of steps to take one after
 * another. Big ideas is what to keep from the whole series. Lectures is every
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
            ? `${videos} videos, ${hours(runtimeMinutes)}, as ${plan.stages.length} stages of lessons, about ${hours(planMinutes)}`
            : `${videos} videos, ${hours(runtimeMinutes)}`
        }
      />
      <Tabs tabs={TABS} label="Course" compact />

      {open === 'plan' &&
        (plan ? (
          <PlanTab course={course} plan={plan} text={text} />
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
                <Markdown markdown={text(idea.body)} className="vault-prose prose-compact" />
              </li>
            ))}
          </ol>
        </Card>
      )}
      {open === 'lectures' && (
        <LecturesTab course={course} digest={digest} text={text} play={play} />
      )}

      <CardSection title="About this digest" fold="learn.course.about" defaultOpen={false}>
        <div className="space-y-3">
          <p className="text-ui text-ink [overflow-wrap:anywhere]">{digest.madeFor}</p>
          <Markdown
            markdown={text(digest.intro)}
            className="vault-prose prose-compact prose-aside"
          />
        </div>
      </CardSection>
    </PageColumn>
  );
}

type Text = (source: string) => string;

/** What a step is made of, for the line under its title: "14 min · 2 clips · drawing · reading". */
function stepLine(step: Step): string {
  const count = (type: string) => step.blocks.filter((block) => block.type === type).length;
  const clips = count('clip');
  return [
    `${step.minutes} min`,
    clips > 0 ? `${clips} ${clips === 1 ? 'clip' : 'clips'}` : null,
    count('figure') > 0 ? 'drawing' : null,
    count('reading') > 0 ? 'reading' : null,
    count('check') > 0 ? 'a question' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PlanTab({ course, plan, text }: { course: Course; plan: Plan; text: Text }) {
  const done = new Set(course.progress.lessons);
  const steps = placedSteps(plan);
  const taken = steps.filter((placed) => done.has(placed.step.key));
  const next = nextStep(plan, done);
  const left = steps.reduce(
    (sum, placed) => sum + (done.has(placed.step.key) ? 0 : placed.step.minutes),
    0,
  );

  return (
    <section className="space-y-4">
      {plan.intro && <Markdown markdown={text(plan.intro)} className="vault-prose prose-compact" />}
      {next ? (
        <div className="space-y-1.5">
          <Link
            href={`/learn/courses/${course.id}/l/${encodeURIComponent(next.step.key)}`}
            className={cn(
              buttonVariants({ variant: 'primary' }),
              'h-auto min-h-11 max-w-full py-2',
            )}
          >
            <span className="min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]">
              {taken.length === 0 ? 'Start' : 'Continue'}: {next.step.title}
            </span>
          </Link>
          <p className="tabular text-small text-ink-muted">
            {taken.length} of {steps.length} steps done · about {hours(left)} left across every
            branch
          </p>
        </div>
      ) : (
        <p className="text-ui text-ink">Every step is done.</p>
      )}

      <div className="space-y-2">
        {stageRows(plan).map((row, index) => (
          <div key={row[0][0].key} className="space-y-2">
            {index > 0 && (
              <div className="flex items-start gap-2 pl-3 text-small text-ink-muted">
                <ArrowDown
                  className="mt-0.5 size-3.5 shrink-0 text-ink-ghost"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {row.length > 1
                    ? `After ${afterTitles(plan, row[0][0]).join(' and ')}, ${row.length} branches. Take whichever you want first.`
                    : `After ${afterTitles(plan, row[0][0]).join(' and ')}`}
                </span>
              </div>
            )}
            <div className={row.length > 1 ? 'grid items-start gap-3 lg:grid-cols-2' : undefined}>
              {row.map((line) => (
                <div key={line[0].key} className="space-y-3">
                  {line.map((stage) => (
                    <StageCard
                      key={stage.key}
                      course={course}
                      plan={plan}
                      stage={stage}
                      done={done}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StageCard({
  course,
  plan,
  stage,
  done,
}: {
  course: Course;
  plan: Plan;
  stage: Stage;
  done: ReadonlySet<string>;
}) {
  const taken = stage.steps.filter((step) => done.has(step.key)).length;
  const minutes = stage.steps.reduce((sum, step) => sum + step.minutes, 0);
  const open = isOpen(plan, stage, done);
  return (
    <Card padding="none">
      <div className="card-pad-x row-pad space-y-1 border-b border-border">
        <h2 className="text-body font-medium text-ink [overflow-wrap:anywhere]">{stage.title}</h2>
        <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{stage.about}</p>
        <p className="tabular text-small text-ink-muted [overflow-wrap:anywhere]">
          {taken} of {stage.steps.length} steps · {hours(minutes)}
          {!open && ` · builds on ${afterTitles(plan, stage).join(' and ')}`}
        </p>
      </div>
      <ol className="divide-y divide-border">
        {stage.steps.map((step, index) => (
          <li key={step.key}>
            <Link
              href={`/learn/courses/${course.id}/l/${encodeURIComponent(step.key)}`}
              className="card-pad-x row-pad flex min-h-11 items-start gap-3 transition-colors duration-quick hover:bg-sunken"
            >
              <span className="tabular w-5 shrink-0 text-ui text-ink-muted">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-ui [overflow-wrap:anywhere]',
                    done.has(step.key) ? 'text-ink-muted' : 'font-medium text-ink',
                  )}
                >
                  {step.title}
                </span>
                <span className="tabular block text-small text-ink-muted">{stepLine(step)}</span>
              </span>
              {done.has(step.key) && (
                <Check
                  className="mt-0.5 size-4 shrink-0 text-positive"
                  strokeWidth={1.75}
                  aria-label="Done"
                />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
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
}: {
  course: Course;
  digest: Digest;
  text: Text;
  play: { code: string; start: number } | null;
}) {
  const rated = new Map(digest.ratings.rows.map((row) => [row.code, row]));
  return (
    <section className="space-y-3">
      {digest.ratings.intro && (
        <Markdown
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
                <Markdown
                  markdown={text(row.where)}
                  className="vault-prose prose-compact prose-aside"
                />
                <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">Said: {row.said}</p>
                <Markdown markdown={text(row.correction)} className="vault-prose prose-compact" />
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
}: {
  lecture: Lecture;
  row: Digest['ratings']['rows'][number] | undefined;
  text: Text;
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
            <Markdown
              markdown={text(row.watch)}
              className="vault-prose prose-compact prose-aside"
            />
          )}
          <Markdown markdown={text(row.why)} className="vault-prose prose-compact prose-aside" />
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
