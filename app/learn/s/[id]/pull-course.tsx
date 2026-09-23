'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { CoursePullReport, PulledCourse } from '@/lib/learn/catalogue/pull-course';
import { pullLectureCourse, type CoursePullState } from './actions';
import { embeddingLine } from './pull-articles';

/**
 * Naming a lecture course for the catalogue, from a subject page.
 *
 * The same shape as the article form above it: closed until asked for, one
 * report line per thing that can go wrong, and the form kept open once a pull
 * has answered so the report stays beside the id that produced it. A course is
 * one playlist, so the field is a single line.
 */
export function PullCourse() {
  const [state, pull] = useActionState<CoursePullState, FormData>(pullLectureCourse, {});
  const [open, setOpen] = useState(false);

  return open || state.report ? (
    <form action={pull} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <Field
        label="Pull a lecture course into the catalogue"
        id="catalogue-playlist"
        hint="The YouTube playlist id of an MIT OpenCourseWare course, or a link to it. Each lecture is stored in order, cut into timed clips from its ocw.mit.edu transcript and embedded, and the embedding is charged to your account. A long course can take a few minutes."
      >
        <Input
          id="catalogue-playlist"
          name="playlist"
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="PLE7DDD91010BC51F8"
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PullButton />
        <CloseButton onClose={() => setOpen(false)} hasReport={Boolean(state.report)} />
        {state.error && (
          <span role="alert" className="text-ui text-danger">
            {state.error}
          </span>
        )}
      </div>

      {state.report && <Report report={state.report} />}
    </form>
  ) : (
    <div className="mt-3">
      <AddTrigger label="Pull a lecture course into the catalogue" onClick={() => setOpen(true)} />
    </div>
  );
}

function CloseButton({ onClose, hasReport }: { onClose: () => void; hasReport: boolean }) {
  const { pending } = useFormStatus();
  if (hasReport) return null;
  return (
    <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
      Cancel
    </Button>
  );
}

function PullButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Fetching lectures and embedding…' : 'Pull it in'}
    </Button>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function Report({ report }: { report: CoursePullReport }) {
  const { course, embedding } = report;

  return (
    <div className="mt-4 space-y-2 text-ui" aria-live="polite">
      {course.ok ? <Stored course={course} /> : <NotStored course={course} />}
      <p
        className={cn(embedding?.stopped ? 'text-danger' : 'text-ink-muted')}
        role={embedding?.stopped ? 'alert' : undefined}
      >
        {embeddingLine(embedding, { one: 'segment', many: 'segments' })}
      </p>
    </div>
  );
}

function NotStored({ course }: { course: Extract<PulledCourse, { ok: false }> }) {
  const why =
    course.reason === 'no-key'
      ? 'YOUTUBE_API_KEY is not set on this deployment, so the playlist cannot be read.'
      : `YouTube or the catalogue refused (${course.reason}): ${course.detail}.`;
  return (
    <p role="alert" className="text-danger">
      Nothing was stored. {why}
    </p>
  );
}

function Stored({ course }: { course: Extract<PulledCourse, { ok: true }> }) {
  const ways: [number, string][] = [
    [course.cutBy.transcript, 'from the transcript'],
    [course.cutBy.chapters, 'by chapters'],
    [course.cutBy.whole, 'as one whole-video segment'],
  ];
  const cut = ways.filter(([count]) => count > 0).map(([count, how]) => `${count} ${how}`);
  const howCut = [
    cut.length > 0 ? `Lectures cut this time: ${cut.join(', ')}.` : '',
    course.kept > 0
      ? `${plural(course.kept, 'lecture was', 'lectures were')} already cut from a transcript and left as they were.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <p>
        <span className="text-ink">{course.title}</span>
        <span className="text-ink-muted">
          {' '}
          · {plural(course.videos, 'lecture', 'lectures')} stored in order,{' '}
          {plural(course.segments, 'segment', 'segments')} written
          {course.removed > 0 ? `, ${course.removed} dropped since last time` : ''}.
        </span>
      </p>
      <p className="text-ink-muted">{howCut}</p>
      {course.notReached > 0 && (
        <p role="alert" className="text-danger">
          The press ran out of time before looking up{' '}
          {plural(course.notReached, 'transcript', 'transcripts')}. Those lectures are stored by
          chapters or as whole videos for now. Press again to fetch their transcripts.
        </p>
      )}
      {course.refusedCount > 0 && (
        <div role="alert" className="text-danger">
          <p>
            ocw.mit.edu refused {plural(course.refusedCount, 'page', 'pages')}, so some
            lectures fell back to chapters or one whole-video segment. Press again to retry them.
          </p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {course.refused.map((line) => (
              <li key={line} className="break-all">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
