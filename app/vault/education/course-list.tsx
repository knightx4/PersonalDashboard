'use client';

import { useActionState, useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { Field, FieldError, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  courseAnchor,
  creditsLabel,
  transcriptAnchor,
  transcriptFileHref,
  type SchoolGroup,
} from '@/lib/vault/education';
import type { Course, Transcript } from '@/lib/vault/transcripts';
import {
  removeCourseAction,
  removeTranscriptAction,
  updateCourseAction,
  type CourseEditState,
} from './actions';

/**
 * One school's courses, term by term with the newest first, and the
 * transcripts it issued (plan #1308). A course is corrected in place from its
 * menu; a transcript opens its original or is deleted with its courses.
 */
export function SchoolCourses({
  group,
  courseCounts,
}: {
  group: SchoolGroup;
  /** How many courses each transcript holds, across every school. */
  courseCounts: Record<string, number>;
}) {
  const courses = group.terms.flatMap((term) => term.courses);
  const credits = courses.reduce((sum, course) => sum + (course.credits ?? 0), 0);
  const summary = [
    `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`,
    credits > 0 ? creditsLabel(Math.round(credits * 100) / 100) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <CardSection title={group.school} hint={summary} className="mb-4">
      {group.terms.map((term) => (
        <section key={`${term.term ?? ''}|${term.year ?? ''}`} className="mt-3 first:mt-0">
          <h3 className="text-small font-medium text-ink-muted">
            {term.term ?? 'No term given'}
            {term.term && term.year && !term.term.includes(String(term.year)) ? ` · ${term.year}` : ''}
          </h3>
          <ul className="divide-y divide-border">
            {term.courses.map((course) => (
              <CourseRow key={course.id} course={course} />
            ))}
          </ul>
        </section>
      ))}

      {group.transcripts.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-small font-medium text-ink-muted">
            {group.transcripts.length === 1 ? 'Transcript' : 'Transcripts'}
          </h3>
          <ul className="divide-y divide-border">
            {group.transcripts.map((transcript) => (
              <TranscriptRow
                key={transcript.id}
                transcript={transcript}
                courses={courseCounts[transcript.id] ?? 0}
              />
            ))}
          </ul>
        </div>
      )}
    </CardSection>
  );
}

function CourseRow({ course }: { course: Course }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <CourseEdit course={course} onClose={() => setEditing(false)} />;

  const credits = creditsLabel(course.credits);
  return (
    <li id={courseAnchor(course.id)} className="flex scroll-mt-20 items-center gap-3 py-2 target:bg-accent-tint">
      <span className="min-w-0 flex-1">
        <span className="block text-body text-ink">
          {course.code && <span className="mr-2 tabular-nums text-ink-muted">{course.code}</span>}
          {course.title}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-body font-medium tabular-nums text-ink">{course.grade ?? '–'}</span>
        {credits && <span className="block text-small tabular-nums text-ink-muted">{credits}</span>}
      </span>
      <ActionMenu
        label={`Actions for ${course.title}`}
        items={[
          { id: 'edit', label: 'Edit', onSelect: () => setEditing(true) },
          {
            id: 'remove',
            label: 'Remove',
            destructive: true,
            confirm: 'Remove this course? It stays on the original transcript.',
            formAction: removeCourseAction,
            formFields: { id: course.id },
          },
        ]}
      />
    </li>
  );
}

function CourseEdit({ course, onClose }: { course: Course; onClose: () => void }) {
  const id = useId();
  const [state, save, saving] = useActionState(async (prev: CourseEditState, form: FormData) => {
    const result = await updateCourseAction(prev, form);
    if (result.saved) onClose();
    return result;
  }, {});
  const error = (field: string) => (state.field === field ? state.error : undefined);
  const field = (
    name: 'school' | 'code' | 'title' | 'term' | 'year' | 'credits' | 'grade',
    label: string,
    value: string | number | null,
    extra: { className?: string; required?: boolean; inputMode?: 'numeric' | 'decimal'; max?: number } = {},
  ) => (
    <Field id={`${id}-${name}`} label={label} error={error(name)} className={extra.className}>
      <Input
        id={`${id}-${name}`}
        name={name}
        defaultValue={value ?? ''}
        required={extra.required}
        inputMode={extra.inputMode}
        maxLength={extra.max}
      />
    </Field>
  );

  return (
    <li id={courseAnchor(course.id)} className="py-3">
      <form action={save} className="space-y-3">
        <input type="hidden" name="id" value={course.id} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {field('title', 'Title', course.title, { className: 'col-span-2 sm:col-span-4', required: true, max: 300 })}
          {field('code', 'Code', course.code, { className: 'sm:col-span-2', max: 50 })}
          {field('term', 'Term', course.term, { className: 'sm:col-span-2', max: 50 })}
          {field('year', 'Year', course.year, { inputMode: 'numeric' })}
          {field('credits', 'Credits', course.credits, { inputMode: 'decimal' })}
          {field('grade', 'Grade', course.grade, { max: 20 })}
          {field('school', 'School', course.school, { className: 'col-span-2 sm:col-span-5', max: 200 })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" pending={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
        {state.error && !state.field && <FieldError>{state.error}</FieldError>}
      </form>
    </li>
  );
}

function TranscriptRow({ transcript, courses }: { transcript: Transcript; courses: number }) {
  return (
    <li
      id={transcriptAnchor(transcript.id)}
      className={cn('flex scroll-mt-20 flex-wrap items-center gap-x-3 gap-y-1 py-2 target:bg-accent-tint')}
    >
      <a
        href={transcriptFileHref(transcript.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full min-w-0 items-center gap-1.5 text-body text-ink hover:text-accent sm:w-auto sm:flex-1"
      >
        <FileText className="size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{transcript.file_name}</span>
      </a>
      {/* On a phone the name takes the whole line and the date and Delete go under it. */}
      <span className="mr-auto pl-5.5 text-small tabular-nums text-ink-muted sm:mr-0 sm:pl-0">
        Added <time dateTime={transcript.uploaded_at}>{day(transcript.uploaded_at)}</time>
      </span>
      <ConfirmStep
        prompt={`Deletes ${transcript.file_name} and the ${courses} ${courses === 1 ? 'course' : 'courses'} saved from it. This cannot be undone.`}
        confirmLabel="Yes, delete"
        pendingLabel="Deleting…"
        action={removeTranscriptAction}
        fields={{ id: transcript.id }}
      >
        Delete
      </ConfirmStep>
    </li>
  );
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
