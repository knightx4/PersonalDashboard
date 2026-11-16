import Link from '@/components/ui/link';
import { ArrowDown, Check } from 'lucide-react';
import { ClipPlayer } from '@/components/learn/clip-player';
import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { Chip, type ChipTone } from '@/components/ui/chip';
import { Markdown } from '@/components/ui/markdown';
import { SectionHeading } from '@/components/ui/section-heading';
import { Tabs } from '@/components/ui/tabs';
import { sectionSubject } from '@/lib/core/section-path';
import {
  clock,
  linkMoments,
  RATING_LABEL,
  type Digest,
  type Lecture,
  type Rating,
} from '@/lib/learn/courses/digest';
import type { Course } from '@/lib/learn/courses/store';
import { hours } from '../format';
import { Tick } from './tick';

/**
 * A built course (docs/LEARN-DIGEST-SPEC.md). The header says what the series
 * was cut from and to. Six tabs, the path first because it is the thing to
 * do: the clips in order, each playing in the page from its start to its end.
 * Lessons are the same material by idea. The rest is the course-level
 * reading: the big ideas, a verdict on every lecture, how the ideas rest on
 * each other and where the lecturers disagree, and what they got wrong.
 *
 * Every timestamp is a link built from the lecture's stored video id
 * (linkMoments), never one a model typed.
 */

const TABS = [
  { id: 'path', label: 'Path' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'ideas', label: 'Big ideas' },
  { id: 'lectures', label: 'Lectures' },
  { id: 'map', label: 'Map' },
  { id: 'errors', label: 'Errors' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function CourseView({
  course,
  digest,
  tab,
}: {
  course: Course;
  digest: Digest;
  tab: string | null;
}) {
  const open: TabId = TABS.some((item) => item.id === tab) ? (tab as TabId) : 'path';
  const { runtimeMinutes = 0, pathMinutes = 0, videos = course.lectures.length } = course.totals;
  const share = runtimeMinutes > 0 ? Math.round((pathMinutes / runtimeMinutes) * 100) : 0;
  const text = (source: string) => linkMoments(source, course.lectures);

  return (
    <PageColumn className="space-y-5">
      <PageHeader
        subject={sectionSubject('/learn/courses', 'Courses', {
          label: course.title,
          href: `/learn/courses/${course.id}`,
        })}
        title={course.title}
        description={`${videos} videos, ${hours(runtimeMinutes)}, cut to a ${hours(pathMinutes)} path (${share}% of the runtime)`}
      />
      <Tabs tabs={TABS} label="Course" compact />

      {open === 'path' && <PathTab course={course} digest={digest} text={text} />}
      {open === 'lessons' && <LessonsTab course={course} digest={digest} />}
      {open === 'ideas' && (
        <Card padding="none">
          <ol className="divide-y divide-border">
            {digest.ideas.map((idea, index) => (
              <li key={idea.title} className="card-pad-x row-pad space-y-1.5">
                <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">
                  <span className="tabular text-ink-muted">{index + 1}. </span>
                  {idea.title}
                </p>
                <Markdown markdown={text(idea.body)} className="text-ui text-ink" />
              </li>
            ))}
          </ol>
        </Card>
      )}
      {open === 'lectures' && <LecturesTab course={course} digest={digest} text={text} />}
      {open === 'map' && <MapTab digest={digest} text={text} />}
      {open === 'errors' && (
        <section className="space-y-3">
          {digest.errors.intro && (
            <Markdown markdown={text(digest.errors.intro)} className="text-ui text-ink-muted" />
          )}
          <Card padding="none">
            <ul className="divide-y divide-border">
              {digest.errors.rows.map((row, index) => (
                <li key={index} className="card-pad-x row-pad space-y-1.5">
                  <Markdown markdown={text(row.where)} className="text-small text-ink-muted" />
                  <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
                    Said: {row.said}
                  </p>
                  <Markdown markdown={text(row.correction)} className="text-ui text-ink" />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
        Cut for: {digest.madeFor}
      </p>
    </PageColumn>
  );
}

type Text = (source: string) => string;

function PathTab({ course, digest, text }: { course: Course; digest: Digest; text: Text }) {
  const byCode = new Map(course.lectures.map((lecture) => [lecture.code, lecture]));
  const watched = new Set(course.progress.clips);
  const total = digest.path.clips.reduce((sum, clip) => sum + clip.minutes, 0);
  const done = digest.path.clips.reduce(
    (sum, clip, index) => sum + (watched.has(String(index)) ? clip.minutes : 0),
    0,
  );
  const next = digest.path.clips.findIndex((_, index) => !watched.has(String(index)));

  return (
    <section className="space-y-3">
      <Markdown markdown={text(digest.intro)} className="text-ui text-ink-muted" />
      {digest.path.intro && (
        <Markdown markdown={text(digest.path.intro)} className="text-ui text-ink" />
      )}
      <SectionHeading
        title="The path"
        count={`${watched.size} of ${digest.path.clips.length} watched · ${done} of ${total} min`}
      />
      <Card padding="none">
        <ol className="divide-y divide-border">
          {digest.path.clips.map((clip, index) => {
            const lecture = byCode.get(clip.code);
            if (!lecture) return null;
            const seen = watched.has(String(index));
            return (
              <li key={index} className="card-pad-x row-pad space-y-2">
                <div className="flex items-start gap-3">
                  <span className="tabular w-5 shrink-0 text-ui text-ink-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        seen ? 'block text-ui text-ink-muted' : 'block text-ui font-medium text-ink'
                      }
                    >
                      {clip.get}
                    </span>
                    <span className="tabular block text-small text-ink-muted [overflow-wrap:anywhere]">
                      {clip.minutes} min · {clip.code} {clock(clip.start)} to {clock(clip.end)} ·{' '}
                      {lecture.title}
                    </span>
                  </span>
                  <Tick
                    courseId={course.id}
                    kind="clips"
                    itemKey={String(index)}
                    done={seen}
                    label="Watched"
                  />
                </div>
                <ClipPlayer
                  videoId={lecture.videoId}
                  title={lecture.speaker ?? lecture.title}
                  start={clip.start}
                  end={clip.end}
                  deferred={index !== next}
                  className="pl-8"
                />
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}

function LessonsTab({ course, digest }: { course: Course; digest: Digest }) {
  const finished = new Set(course.progress.lessons);
  return (
    <Card padding="none">
      <ul className="divide-y divide-border">
        {digest.lessons.map((lesson) => {
          const count = (treatment: string) =>
            lesson.ideas.filter((idea) => idea.treatment === treatment).length;
          const parts = [
            count('clip') ? `${count('clip')} to watch` : null,
            count('worked') ? `${count('worked')} worked` : null,
            count('card') ? `${count('card')} in a line` : null,
            count('skip') ? `${count('skip')} skipped` : null,
          ].filter(Boolean);
          return (
            <li key={lesson.key}>
              <Link
                href={`/learn/courses/${course.id}/l/${encodeURIComponent(lesson.key)}`}
                className="card-pad-x row-pad flex min-h-11 items-start gap-3 transition-colors duration-quick hover:bg-sunken"
              >
                <span className="tabular w-5 shrink-0 text-ui text-ink-muted">{lesson.key}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui font-medium text-ink [overflow-wrap:anywhere]">
                    {lesson.title}
                  </span>
                  <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                    {lesson.point}
                  </span>
                  <span className="tabular block text-small text-ink-muted">
                    {parts.join(' · ')}
                  </span>
                </span>
                {finished.has(lesson.key) && (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-positive"
                    strokeWidth={1.75}
                    aria-label="Done"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const RATING_TONE: Record<Rating, ChipTone> = {
  watch: 'accent',
  parts: 'positive',
  skim: 'neutral',
  skip: 'neutral',
};

function LecturesTab({ course, digest, text }: { course: Course; digest: Digest; text: Text }) {
  const rated = new Map(digest.ratings.rows.map((row) => [row.code, row]));
  return (
    <section className="space-y-3">
      {digest.ratings.intro && (
        <Markdown markdown={text(digest.ratings.intro)} className="text-ui text-ink-muted" />
      )}
      <Card padding="none">
        <ul className="divide-y divide-border">
          {course.lectures.map((lecture) => (
            <LectureRow
              key={lecture.code}
              lecture={lecture}
              row={rated.get(lecture.code)}
              text={text}
            />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function LectureRow({
  lecture,
  row,
  text,
}: {
  lecture: Lecture;
  row: Digest['ratings']['rows'][number] | undefined;
  text: Text;
}) {
  return (
    <li className="card-pad-x row-pad space-y-1">
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
          {row.watch && <Markdown markdown={text(row.watch)} className="text-small text-ink" />}
          <Markdown markdown={text(row.why)} className="text-small text-ink-muted" />
        </div>
      )}
    </li>
  );
}

function MapTab({ digest, text }: { digest: Digest; text: Text }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionHeading title="What rests on what" />
        {digest.dependencies.intro && (
          <Markdown markdown={text(digest.dependencies.intro)} className="text-ui text-ink-muted" />
        )}
        <Card padding="dense" className="grid gap-6 sm:grid-cols-2">
          {digest.dependencies.tracks.map((track) => (
            <div key={track.title} className="space-y-2">
              <p className="text-ui font-medium text-ink">{track.title}</p>
              <ol className="flex flex-col items-start gap-1">
                {track.steps.map((step, index) => (
                  <li key={`${step}-${index}`} className="flex flex-col items-start gap-1">
                    {index > 0 && (
                      <ArrowDown
                        className="ml-2 size-3.5 text-ink-ghost"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    )}
                    <Chip className="h-auto whitespace-normal py-1 text-left">{step}</Chip>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Where the series disagrees with itself"
          count={digest.tensions.rows.length}
        />
        {digest.tensions.intro && (
          <Markdown markdown={text(digest.tensions.intro)} className="text-ui text-ink-muted" />
        )}
        <Card padding="none">
          <ul className="divide-y divide-border">
            {digest.tensions.rows.map((row) => (
              <li key={row.tension} className="card-pad-x row-pad space-y-2">
                <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">
                  {row.tension}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Markdown markdown={text(row.oneSide)} className="text-ui text-ink" />
                  <Markdown markdown={text(row.otherSide)} className="text-ui text-ink" />
                </div>
                <Markdown markdown={text(row.lands)} className="text-small text-ink-muted" />
              </li>
            ))}
          </ul>
        </Card>
        {digest.tensions.outro && (
          <Markdown markdown={text(digest.tensions.outro)} className="text-ui text-ink" />
        )}
      </section>
    </div>
  );
}
