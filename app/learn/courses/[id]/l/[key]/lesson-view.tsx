import Link from '@/components/ui/link';
import { ClipPlayer } from '@/components/learn/clip-player';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import {
  clock,
  linkMoments,
  type Block,
  type Lecture,
  type Stage,
  type Step,
} from '@/lib/learn/courses/digest';
import { shortName, type Placed } from '@/lib/learn/courses/plan';
import type { Course } from '@/lib/learn/courses/store';
import { ReaderFigure } from '../../../../read/figure';
import { CourseMarkdown } from '../../course-markdown';
import { momentHref } from '../../course-view';
import { StepFoot, type Onward } from './step-foot';

/**
 * One step of a course's plan (docs/LEARN-DIGEST-SPEC.md, "The plan"). At the
 * top, where it sits in its stage, and what it gets you. Its blocks are drawn
 * in the order they were written, because that is the order to take them in:
 * words that set a clip up, the clip playing in the page, what to make of it,
 * a drawing, a piece of a reading, a question to try. At the foot, one press
 * that marks it done and goes on (step-foot.tsx).
 */
export function LessonView({
  course,
  placed,
  next,
}: {
  course: Course;
  placed: Placed;
  next: { step: Step | null; stages: Stage[] };
}) {
  const { stage, step, at } = placed;
  const text = (source: string) => linkMoments(source, course.lectures, momentHref(course.id));
  const byCode = new Map(course.lectures.map((lecture) => [lecture.code, lecture]));
  const stepHref = (key: string) => `/learn/courses/${course.id}/l/${encodeURIComponent(key)}`;
  const mapHref = `/learn/courses/${course.id}`;
  const maths = course.digest?.maths === true;
  const done = new Set(course.progress.lessons);
  // The first clip is ready to play; the rest load when pressed, so a step with several stays light.
  const firstClip = step.blocks.findIndex((block) => block.type === 'clip');
  const minutes = (item: Stage) => item.steps.reduce((sum, each) => sum + each.minutes, 0);

  const onward: { kind: 'step' | 'stages'; to: Onward[] } = next.step
    ? {
        kind: 'step',
        to: [{ href: stepHref(next.step.key), title: next.step.title, minutes: next.step.minutes }],
      }
    : {
        kind: 'stages',
        to: next.stages.map((item) => ({
          href: stepHref(item.steps[0].key),
          title: item.title,
          about: item.about,
          minutes: minutes(item),
        })),
      };

  return (
    <PageColumn>
      {/* One readable measure, so the words, the players and the drawings share their edges. */}
      <div className="max-w-prose space-y-5">
        <PageHeader
          subject={sectionSubject(
            '/learn/courses',
            'Courses',
            { label: course.title, href: mapHref },
            { label: step.title, href: stepHref(step.key) },
          )}
          title={step.title}
          description={step.gain ?? undefined}
        />

        <div className="space-y-1.5">
          <ol
            className="flex gap-1"
            aria-label={`Step ${at + 1} of ${stage.steps.length} in ${shortName(stage)}`}
          >
            {stage.steps.map((item, index) => (
              <li
                key={item.key}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  index === at ? 'bg-ink' : done.has(item.key) ? 'bg-accent' : 'bg-border-strong',
                )}
              />
            ))}
          </ol>
          <p className="tabular text-small text-ink-muted [overflow-wrap:anywhere]">
            {shortName(stage)} · step {at + 1} of {stage.steps.length} · {step.minutes} min
          </p>
        </div>

        {step.blocks.map((block, index) => (
          <BlockView
            key={index}
            block={block}
            lectures={byCode}
            text={text}
            maths={maths}
            deferred={index !== firstClip}
            fold={`learn.course.check.${course.id}.${step.key}.${index}`}
          />
        ))}

        <StepFoot
          key={step.key}
          courseId={course.id}
          stepKey={step.key}
          done={done.has(step.key)}
          stageTitle={shortName(stage)}
          onward={onward}
          mapHref={mapHref}
        />
      </div>
    </PageColumn>
  );
}

function BlockView({
  block,
  lectures,
  text,
  maths,
  deferred,
  fold,
}: {
  block: Block;
  lectures: ReadonlyMap<string, Lecture>;
  text: (source: string) => string;
  maths: boolean;
  deferred: boolean;
  fold: string;
}) {
  if (block.type === 'text') {
    return (
      <section className="space-y-1.5">
        {block.title && (
          <h2 className="text-body font-medium text-ink [overflow-wrap:anywhere]">{block.title}</h2>
        )}
        <CourseMarkdown
          maths={maths}
          markdown={text(block.body)}
          className="vault-prose max-w-none"
        />
      </section>
    );
  }

  if (block.type === 'clip') {
    const lecture = lectures.get(block.code);
    if (!lecture) return null;
    return (
      <Card padding="dense" className="space-y-2">
        <p className="tabular text-small text-ink-muted [overflow-wrap:anywhere]">
          Watch · {block.minutes} min · {lecture.speaker ?? lecture.title} · {block.code}{' '}
          {clock(block.start)} to {clock(block.end)}
        </p>
        <p className="text-ui text-ink [overflow-wrap:anywhere]">Listen for: {block.listenFor}</p>
        <ClipPlayer
          videoId={lecture.videoId}
          title={lecture.title}
          start={block.start}
          end={block.end}
          deferred={deferred}
        />
      </Card>
    );
  }

  if (block.type === 'figure') return <ReaderFigure figure={block} />;

  if (block.type === 'reading') {
    return (
      <Card padding="dense" className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-small text-ink-muted">Reading</p>
          <h2 className="text-body font-medium text-ink [overflow-wrap:anywhere]">{block.title}</h2>
          {(block.author || block.source) && (
            <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
              {[block.author, block.source].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <CourseMarkdown
          maths={maths}
          markdown={text(block.body)}
          className="vault-prose prose-compact"
        />
        {block.excerpt.length > 0 && (
          <div className="space-y-3 border-l-2 border-border-strong pl-4">
            <div className="vault-prose">
              {block.excerpt.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            {block.licence && (
              <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
                The author&rsquo;s text, shown under {block.licence}.
              </p>
            )}
          </div>
        )}
        {block.url && (
          <Link
            href={block.url}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'max-w-full')}
          >
            Open the whole text
          </Link>
        )}
      </Card>
    );
  }

  return (
    <CardSection title="Try it" fold={fold}>
      <div className="space-y-3">
        <CourseMarkdown
          maths={maths}
          markdown={text(block.question)}
          className="vault-prose prose-compact"
        />
        <Disclosure title="The answer">
          <CourseMarkdown
            maths={maths}
            markdown={text(block.answer)}
            className="vault-prose prose-compact"
          />
        </Disclosure>
      </div>
    </CardSection>
  );
}
