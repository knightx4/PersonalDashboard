import Link from '@/components/ui/link';
import { ClipPlayer } from '@/components/learn/clip-player';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { Markdown } from '@/components/ui/markdown';
import { SectionHeading } from '@/components/ui/section-heading';
import { sectionSubject } from '@/lib/core/section-path';
import {
  clock,
  linkMoments,
  TREATMENT_LABEL,
  type Idea,
  type Lecture,
  type Lesson,
} from '@/lib/learn/courses/digest';
import type { Course } from '@/lib/learn/courses/store';
import { Tick } from '../../tick';

/**
 * One lesson of a course: a cluster of ideas (docs/LEARN-DIGEST-SPEC.md,
 * "Lesson shape"). The point first, in one sentence. Then each idea in the
 * form it was given: the ones to watch with their clip in the page, the
 * worked ones written out with numbers, the rest in a line each, and what was
 * skipped with the reason, folded, so the person can overrule it. Then a
 * question to try, and who in the series disagrees.
 */
export function LessonView({
  course,
  lesson,
  at,
  total,
  next,
}: {
  course: Course;
  lesson: Lesson;
  at: number;
  total: number;
  next: Lesson | null;
}) {
  const text = (source: string) => linkMoments(source, course.lectures);
  const full = lesson.ideas.filter(
    (idea) => idea.treatment === 'clip' || idea.treatment === 'worked',
  );
  const cards = lesson.ideas.filter((idea) => idea.treatment === 'card');
  const skipped = lesson.ideas.filter((idea) => idea.treatment === 'skip');

  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject(
          '/learn/courses',
          'Courses',
          { label: course.title, href: `/learn/courses/${course.id}?tab=lessons` },
          {
            label: lesson.title,
            href: `/learn/courses/${course.id}/l/${encodeURIComponent(lesson.key)}`,
          },
        )}
        title={lesson.title}
        description={`Lesson ${at + 1} of ${total}`}
      />

      <Card padding="dense" className="bg-accent-tint">
        <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{lesson.point}</p>
      </Card>

      {full.map((idea) => (
        <IdeaCard key={idea.name} idea={idea} lectures={course.lectures} text={text} />
      ))}

      {cards.length > 0 && (
        <section className="space-y-2">
          <SectionHeading title="In a line each" count={cards.length} />
          <Card padding="none">
            <ul className="divide-y divide-border">
              {cards.map((idea) => (
                <li key={idea.name} className="card-pad-x row-pad space-y-0.5">
                  <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">
                    {idea.name}
                  </p>
                  <Markdown markdown={text(idea.body)} className="vault-prose prose-compact" />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {lesson.check && (
        <CardSection title="Try it" fold={`learn.course.check.${course.id}.${lesson.key}`}>
          <div className="space-y-3">
            <Markdown
              markdown={text(lesson.check.question)}
              className="vault-prose prose-compact"
            />
            <Disclosure title="The answer">
              <Markdown
                markdown={text(lesson.check.answer)}
                className="vault-prose prose-compact"
              />
            </Disclosure>
          </div>
        </CardSection>
      )}

      {lesson.tension && (
        <CardSection title="Where the series disagrees">
          <Markdown markdown={text(lesson.tension)} className="vault-prose prose-compact" />
        </CardSection>
      )}

      {skipped.length > 0 && (
        <CardSection
          title="Skipped, and why"
          fold={`learn.course.skipped.${course.id}`}
          defaultOpen={false}
          meta={skipped.length}
        >
          <ul className="space-y-2">
            {skipped.map((idea) => (
              <li key={idea.name}>
                <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{idea.name}</p>
                <Markdown
                  markdown={text(idea.body)}
                  className="vault-prose prose-compact prose-aside"
                />
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tick
          courseId={course.id}
          kind="lessons"
          itemKey={lesson.key}
          done={course.progress.lessons.includes(lesson.key)}
          label="Done"
        />
        {next ? (
          <Link
            href={`/learn/courses/${course.id}/l/${encodeURIComponent(next.key)}`}
            className={buttonVariants({ variant: 'primary' })}
          >
            Next: {next.title}
          </Link>
        ) : (
          <Link
            href={`/learn/courses/${course.id}?tab=ideas`}
            className={buttonVariants({ variant: 'primary' })}
          >
            The big ideas
          </Link>
        )}
      </div>
    </PageColumn>
  );
}

function IdeaCard({
  idea,
  lectures,
  text,
}: {
  idea: Idea;
  lectures: Lecture[];
  text: (source: string) => string;
}) {
  const byCode = new Map(lectures.map((lecture) => [lecture.code, lecture]));
  return (
    <Card padding="dense" className="space-y-3">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-body font-medium text-ink [overflow-wrap:anywhere]">
          {idea.name}
        </h2>
        <Chip tone={idea.treatment === 'clip' ? 'accent' : 'neutral'}>
          {TREATMENT_LABEL[idea.treatment]}
        </Chip>
      </div>
      <Markdown markdown={text(idea.body)} className="vault-prose prose-compact" />
      {idea.clips.map((clip, index) => {
        const lecture = byCode.get(clip.code);
        if (!lecture) return null;
        return (
          <div key={index} className="space-y-1.5">
            {clip.listenFor && (
              <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
                Listen for: {clip.listenFor}
              </p>
            )}
            <ClipPlayer
              videoId={lecture.videoId}
              title={`${clip.code} ${clock(clip.start)}${clip.end ? ` to ${clock(clip.end)}` : ''} · ${lecture.speaker ?? lecture.title}`}
              start={clip.start}
              end={clip.end}
              deferred
            />
          </div>
        );
      })}
    </Card>
  );
}
