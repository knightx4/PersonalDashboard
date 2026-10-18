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
} from '@/lib/you/education';
import type { Course, CourseFile, CourseWeek, Transcript } from '@/lib/you/transcripts';
import type { CourseNote, CourseOverview } from '@/lib/you/course-overview';
import { courseFilesCount } from '@/lib/you/course-files';
import {
  removeCourseAction,
  removeTranscriptAction,
  updateCourseAction,
  type CourseEditState,
} from './actions';
import { whenDate } from '@/lib/core/when';
import type { CourseExplain } from '@/lib/learn/evidence/course-explain';
import { CourseExplainForm, CourseExplainLine } from './course-explain';
import { CourseFiles, type ChosenFile } from './course-files';

/** The gallery's way to draw one course with its files open, and which hidden part showing. */
export type FilesOpen = {
  courseId: string;
  adding?: boolean;
  chosen?: ChosenFile[];
  uploading?: boolean;
  showRemove?: string;
  confirming?: string;
  summarising?: string;
  summariseErrors?: Record<string, string>;
  summaryOpen?: string;
  costOpen?: string;
  /** A week heading being edited, by its week row's id (plan #2401.6). */
  editingWeek?: string;
  /** A failed read of the syllabus's weeks. */
  weeksError?: string;
  /** The syllabus mid-read for its weeks. */
  readingWeeks?: boolean;
  /** The course block mid-read (plan #2401.7). */
  collecting?: boolean;
  /** A failed read for the course block. */
  overviewError?: string;
  /** The course block's cost hint open, as hover shows it. */
  overviewCostOpen?: boolean;
};

/**
 * One school's courses, term by term with the newest first, and the
 * transcripts it issued (plan #1308). A course is corrected in place from its
 * menu; a transcript opens its original or is deleted with its courses.
 */
export function SchoolCourses({
  group,
  courseCounts,
  explains = {},
  explaining,
  files = {},
  weeks = {},
  overviews = {},
  notes = {},
  filesOpen,
}: {
  group: SchoolGroup;
  /** How many courses each transcript holds, across every school. */
  courseCounts: Record<string, number>;
  /** Each graded course's explain prompt or what its answer showed, by course id (plan #2172.4.2). */
  explains?: Record<string, CourseExplain>;
  /** The gallery's way to draw one course with its prompt open. */
  explaining?: string;
  /** The files kept under each course, by course id (plan #2401.2). */
  files?: Record<string, CourseFile[]>;
  /** The weeks laid out from each course's syllabus, by course id (plan #2401.6). */
  weeks?: Record<string, CourseWeek[]>;
  /** What each course was about, by course id (plan #2401.7). */
  overviews?: Record<string, CourseOverview>;
  /** The person's own notes naming each course, by course id (plan #2401.7). */
  notes?: Record<string, CourseNote[]>;
  filesOpen?: FilesOpen;
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
            {term.term && term.year && !term.term.includes(String(term.year))
              ? ` · ${term.year}`
              : ''}
          </h3>
          <ul className="divide-y divide-border">
            {term.courses.map((course) => (
              <CourseRow
                key={course.id}
                course={course}
                explain={explains[course.id]}
                explaining={explaining === course.id}
                files={files[course.id] ?? []}
                weeks={weeks[course.id] ?? []}
                overview={overviews[course.id] ?? null}
                notes={notes[course.id] ?? []}
                filesOpen={filesOpen?.courseId === course.id ? filesOpen : undefined}
              />
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

function CourseRow({
  course,
  explain,
  explaining = false,
  files,
  weeks,
  overview,
  notes,
  filesOpen,
}: {
  course: Course;
  explain?: CourseExplain;
  explaining?: boolean;
  files: CourseFile[];
  weeks: CourseWeek[];
  overview: CourseOverview | null;
  notes: CourseNote[];
  filesOpen?: FilesOpen;
}) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(explaining);
  const [showFiles, setShowFiles] = useState(filesOpen !== undefined);
  // Counts presses of the menu's Add files, so each one opens the drawer afresh.
  const [addFiles, setAddFiles] = useState(filesOpen?.adding ? 1 : 0);
  const filesId = `${courseAnchor(course.id)}-files`;
  if (editing) return <CourseEdit course={course} onClose={() => setEditing(false)} />;

  const credits = creditsLabel(course.credits);
  const prompt = open && explain?.state === 'offer' ? explain : null;
  return (
    <li id={courseAnchor(course.id)} className="scroll-mt-bar py-2 target:bg-accent-tint">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          {/* The course opens to its files (plan #2401.2). */}
          <button
            type="button"
            aria-expanded={showFiles}
            aria-controls={filesId}
            onClick={() => setShowFiles((shown) => !shown)}
            className="block text-left text-body text-ink hover:text-accent"
          >
            {course.code && <span className="mr-2 tabular-nums text-ink-muted">{course.code}</span>}
            {course.title}
          </button>
          {files.length > 0 && !showFiles && (
            <span className="block text-small text-ink-muted">{courseFilesCount(files.length)}</span>
          )}
          {explain && !prompt && (
            <CourseExplainLine explain={explain} onOpen={() => setOpen(true)} />
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-body font-medium tabular-nums text-ink">
            {course.grade ?? '–'}
          </span>
          {credits && (
            <span className="block text-small tabular-nums text-ink-muted">{credits}</span>
          )}
        </span>
        <ActionMenu
          label={`Actions for ${course.title}`}
          items={[
            {
              id: 'files',
              label: 'Add files',
              onSelect: () => {
                setShowFiles(true);
                setAddFiles((n) => n + 1);
              },
            },
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
      </div>
      {prompt && (
        <CourseExplainForm
          courseId={course.id}
          question={prompt.question}
          onClose={() => setOpen(false)}
        />
      )}
      {showFiles && (
        <div id={filesId}>
          <CourseFiles
            key={addFiles}
            courseId={course.id}
            courseTitle={course.title}
            files={files}
            weeks={weeks}
            overview={overview}
            notes={notes}
            adding={addFiles > 0}
            chosen={filesOpen?.chosen}
            uploading={filesOpen?.uploading}
            showRemove={filesOpen?.showRemove}
            confirming={filesOpen?.confirming}
            summarising={filesOpen?.summarising}
            summariseErrors={filesOpen?.summariseErrors}
            summaryOpen={filesOpen?.summaryOpen}
            costOpen={filesOpen?.costOpen}
            editingWeek={filesOpen?.editingWeek}
            weeksError={filesOpen?.weeksError}
            readingWeeks={filesOpen?.readingWeeks}
            collecting={filesOpen?.collecting}
            overviewError={filesOpen?.overviewError}
            overviewCostOpen={filesOpen?.overviewCostOpen}
          />
        </div>
      )}
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
    extra: {
      className?: string;
      required?: boolean;
      inputMode?: 'numeric' | 'decimal';
      max?: number;
    } = {},
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
          {field('title', 'Title', course.title, {
            className: 'col-span-2 sm:col-span-4',
            required: true,
            max: 300,
          })}
          {field('code', 'Code', course.code, { className: 'sm:col-span-2', max: 50 })}
          {field('term', 'Term', course.term, { className: 'sm:col-span-2', max: 50 })}
          {field('year', 'Year', course.year, { inputMode: 'numeric' })}
          {field('credits', 'Credits', course.credits, { inputMode: 'decimal' })}
          {field('grade', 'Grade', course.grade, { max: 20 })}
          {field('school', 'School', course.school, {
            className: 'col-span-2 sm:col-span-5',
            max: 200,
          })}
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
      className={cn(
        'flex scroll-mt-bar flex-wrap items-center gap-x-3 gap-y-1 py-2 target:bg-accent-tint',
      )}
    >
      <a
        href={transcriptFileHref(transcript.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-full min-w-0 items-center gap-1.5 text-body text-ink hover:text-accent sm:min-h-0 sm:w-auto sm:flex-1"
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
  return whenDate(iso, { timeZone: 'UTC' });
}
