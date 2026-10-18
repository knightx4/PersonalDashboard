'use client';

import { useActionState, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, FileText } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { DashAction } from '@/components/ui/dash-action';
import { InlineInput, Input, PressLabel, Select } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  COURSE_FILE_ACCEPT,
  COURSE_FILE_HINT,
  courseFileContentType,
  courseFileHref,
  courseFileSize,
  groupCourseFiles,
  parseWeek,
  refuseCourseFiles,
  weekName,
  type CourseFileGroup,
} from '@/lib/you/course-files';
import { uploadCourseFile } from '@/lib/you/course-file-upload';
import {
  COURSE_FILE_KINDS,
  COURSE_FILE_KIND_LABELS,
  type CourseFile,
  type CourseFileKind,
  type CourseWeek,
} from '@/lib/you/transcripts';
import {
  addCourseFileAction,
  readSyllabusWeeksAction,
  removeCourseFileAction,
  removeCourseWeekAction,
  renameCourseWeekAction,
  summariseCourseFileAction,
  type ReadSyllabusWeeksState,
  type SummariseCourseFileState,
} from './actions';
import { CourseOverviewBlock } from './course-overview';
import type { CourseNote, CourseOverview } from '@/lib/you/course-overview';

/**
 * The files kept under one course (plan #2401.2), each opening its
 * original through a one-minute signed link. "Add files" opens a drawer under
 * the list where several files are chosen at once, each given its kind and
 * week, and uploaded one after another with its own progress. A file the
 * bucket would refuse says why on its row before anything is sent, and a
 * failed upload keeps its row with the reason.
 *
 * Each file has Summarise (plan #2401.4): Dash reads it once, on the press
 * and at the cost its hint shows, and keeps a summary and up to five key
 * points. A read that fails keeps nothing and says why under the row.
 *
 * The files run week by week (plan #2401.5), lectures before readings, and a
 * summarised file shows its summary under it, two lines until opened in
 * place, then the key points and Summarise again.
 *
 * Under the syllabus, "Lay out the weeks" (plan #2401.6) has Dash read it,
 * on the press and at the cost its hint shows, and list the course's weeks
 * with their topics. Each week then shows as a heading with its topic, an
 * empty one saying nothing is kept for it yet, and the add drawer offers the
 * weeks by name. A week's Edit changes its topic or removes it, and reading
 * the syllabus again leaves weeks changed that way as they were left.
 *
 * Above the files, a block says what the course was about and what came
 * back across its files once Dash has pulled it together from two or more
 * summaries, with the person's own notes that name the course under it
 * (plan #2401.7, course-overview.tsx).
 */

/** One chosen file in the add drawer, and where its upload has got to. */
export type ChosenFile = {
  key: number;
  name: string;
  size: number;
  /** Absent in the gallery, which draws rows without real files. */
  file?: File;
  kind: CourseFileKind;
  week: string;
  /** Why it will not be or was not kept; null while it can still go. */
  problem: string | null;
  /** True for a refusal found before upload: the row cannot be sent at all. */
  refused: boolean;
  /** 0 to 1 while uploading; null before it starts. */
  progress: number | null;
};

export function CourseFiles({
  courseId,
  courseTitle,
  files,
  weeks = [],
  overview = null,
  notes = [],
  adding = false,
  chosen: initialChosen,
  uploading: initialUploading = false,
  confirming,
  summarising,
  summariseErrors,
  summaryOpen,
  costOpen,
  editingWeek,
  weeksError,
  readingWeeks = false,
  collecting = false,
  overviewError,
  overviewCostOpen = false,
}: {
  courseId: string;
  courseTitle: string;
  files: CourseFile[];
  /** The weeks laid out from the syllabus, removed ones included (plan #2401.6). */
  weeks?: CourseWeek[];
  /** What the course was about, as Dash pulled it together (plan #2401.7). */
  overview?: CourseOverview | null;
  /** The person's own notes that name the course. */
  notes?: CourseNote[];
  /** Open with the add drawer showing. */
  adding?: boolean;
  /** The gallery's way to draw the drawer with files chosen. */
  chosen?: ChosenFile[];
  /** The gallery's way to draw the drawer mid-upload. */
  uploading?: boolean;
  /** The gallery's way to draw one row's confirm armed. */
  confirming?: string;
  /** The gallery's way to draw one row mid-read. */
  summarising?: string;
  /** The gallery's way to draw a failed read, by file id. */
  summariseErrors?: Record<string, string>;
  /** The gallery's way to draw one file's summary opened. */
  summaryOpen?: string;
  /** The gallery's way to draw one file's cost hint open, as hover shows it. */
  costOpen?: string;
  /** The gallery's way to draw one week heading being edited, by its row's id. */
  editingWeek?: string;
  /** The gallery's way to draw a failed read of the syllabus's weeks. */
  weeksError?: string;
  /** The gallery's way to draw the syllabus mid-read for its weeks. */
  readingWeeks?: boolean;
  /** The gallery's way to draw the course block mid-read. */
  collecting?: boolean;
  /** The gallery's way to draw a failed read for the course block. */
  overviewError?: string;
  /** The gallery's way to draw the course block's cost hint open. */
  overviewCostOpen?: boolean;
}) {
  const [open, setOpen] = useState(adding);
  const groups = groupCourseFiles(files, weeks);
  const slots = weeks.filter((week) => !week.removed_at);

  return (
    <div className="mt-2 border-l-2 border-border pl-3 sm:ml-1">
      {groups.length === 0 && !open && (
        <p className="py-1 text-ui text-ink-muted">
          No files yet. Add the syllabus, slides, lecture notes and readings you kept from this course.
        </p>
      )}
      <CourseOverviewBlock
        courseId={courseId}
        files={files}
        overview={overview}
        notes={notes}
        collecting={collecting}
        error={overviewError}
        costOpen={overviewCostOpen}
      />
      {groups.map((group) => (
        <section key={group.key} className="mt-2 first:mt-0" aria-label={group.label}>
          {group.slot ? (
            <WeekHeading group={group} slot={group.slot} editing={editingWeek === group.slot.id} />
          ) : (
            <h4 className="text-small font-medium text-ink-muted">{group.label}</h4>
          )}
          {/* An empty week is its heading alone: the slot a file is attached to. */}
          <ul>
            {group.files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                confirming={confirming === file.id}
                summarising={summarising === file.id}
                summariseError={summariseErrors?.[file.id]}
                summaryOpen={summaryOpen === file.id}
                costOpen={costOpen === file.id}
              />
            ))}
          </ul>
          {group.key === 'syllabus' && (
            <LayOutWeeks
              courseId={courseId}
              again={weeks.length > 0}
              error={weeksError}
              reading={readingWeeks}
            />
          )}
        </section>
      ))}
      {open ? (
        <AddFiles
          courseId={courseId}
          courseTitle={courseTitle}
          held={files.length}
          slots={slots}
          initial={initialChosen}
          initialUploading={initialUploading}
          onClose={() => setOpen(false)}
        />
      ) : (
        <AddTrigger label="Add files" onClick={() => setOpen(true)} className="mt-1" />
      )}
    </div>
  );
}

function FileRow({
  file,
  confirming,
  summarising,
  summariseError,
  summaryOpen,
  costOpen,
}: {
  file: CourseFile;
  confirming: boolean;
  summarising: boolean;
  summariseError?: string;
  summaryOpen: boolean;
  costOpen: boolean;
}) {
  const toast = useToast();
  const [state, summarise, reading] = useActionState<SummariseCourseFileState, FormData>(
    async (prev, form) => {
      const next: SummariseCourseFileState = await summariseCourseFileAction(prev, form).catch(() => ({
        error: 'That file could not be read. Try again.',
      }));
      if (next.summarised) toast({ text: `Summarised ${file.title}.` });
      return next;
    },
    summariseError ? { error: summariseError } : {},
  );
  const pending = reading || summarising;
  const read = file.summary ?? null;
  // The heading is the week, so the row says what the file is; the syllabus heading says it already.
  const meta = [file.kind === 'syllabus' ? null : COURSE_FILE_KIND_LABELS[file.kind], courseFileSize(file.size_bytes)]
    .filter(Boolean)
    .join(' · ');
  const press = (label: string) => (
    <form action={summarise}>
      <input type="hidden" name="id" value={file.id} />
      <DashAction
        type="submit"
        size="xs"
        variant="ghost"
        pending={pending}
        paid="app/you/work/actions.ts#summariseCourseFileAction"
        what={`Cost of summarising ${file.title}`}
        hintOpen={costOpen}
      >
        {pending ? 'Summarising…' : label}
      </DashAction>
    </form>
  );
  return (
    <li className="group flex flex-wrap items-center gap-x-3 py-1.5 sm:py-0.5">
      <a
        href={courseFileHref(file.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="press-area inline-flex w-full min-w-0 items-start gap-1.5 text-body text-ink hover:text-accent sm:min-h-8 sm:w-auto sm:flex-1 sm:items-center"
      >
        <FileText className="mt-1 size-4 shrink-0 text-ink-muted sm:mt-0" strokeWidth={1.75} aria-hidden />
        <span className="line-clamp-2 sm:truncate">{file.title}</span>
      </a>
      {/* On a phone a file is two lines: the title across the whole row,
        * then the facts with Summarise and Remove at their end. From laptop
        * width the wrapper steps aside and the facts, Summarise and Remove
        * are columns every row ends on; a summarised file leaves the
        * Summarise column empty, since its press lives with the summary.
        * While the confirm is armed it drops to a line of its own under the
        * facts, so the column keeps its place (5.75rem is the Remove slot
        * and its gap). */}
      <div className="flex w-full flex-wrap items-center gap-x-2 pl-5.5 sm:contents">
        <span className="mr-auto text-small tabular-nums text-ink-muted sm:mr-0">
          {/* On a phone the kind alone, with "Notes" for lecture notes, keeps the
            * facts, Summarise with its cost and Remove on one line. */}
          <span className="sm:hidden">
            {file.kind === 'syllabus'
              ? courseFileSize(file.size_bytes)
              : file.kind === 'lecture_notes'
                ? 'Notes'
                : COURSE_FILE_KIND_LABELS[file.kind]}
          </span>
          <span className="hidden sm:inline">{meta}</span>
        </span>
        {read ? (
          <span aria-hidden className="hidden sm:block sm:min-w-36 sm:group-has-[p]:mr-23" />
        ) : (
          <div className="-my-1 sm:my-0 sm:min-w-36 sm:group-has-[p]:mr-23">{press('Summarise')}</div>
        )}
        {/* Remove is always drawn, at every width, so each row ends on the
          * course card's right edge rather than on an empty hover slot. */}
        <span
          className={cn(
            '-my-1 sm:my-0 sm:min-w-20 sm:text-right',
            'has-[p]:my-1 has-[p]:w-full has-[p]:text-left sm:has-[p]:pl-5.5',
          )}
        >
          <ConfirmStep
            align="start"
            prompt={`Removes ${file.file_name} from the course. This cannot be undone.`}
            confirmLabel="Yes, remove"
            pendingLabel="Removing…"
            action={removeCourseFileAction}
            fields={{ id: file.id }}
            defaultArmed={confirming}
          >
            Remove
          </ConfirmStep>
        </span>
      </div>
      {/* Dash's summary under the file (plan #2401.5): two lines until it is
        * opened, then the whole of it, the key points and the press to read
        * the file again. No p in here: the row's group-has-[p] rule is how
        * the armed Remove confirm finds its own. */}
      {read && (
        // Dash's words sit on the recessed ground (voice-dash), apart from the file rows.
        <div className="w-full pl-5.5 sm:mb-1 sm:mt-0.5">
          {/* ui-ok: hand-rolled-fold -- the closed line is the summary's own first two lines, which then open in place; Disclosure's title row would show them twice */}
          <details open={summaryOpen} className="group/summary voice-dash max-w-prose px-2.5 py-1.5">
            <summary className="flex cursor-pointer list-none items-start gap-1 rounded-control text-ui focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
              <span className="line-clamp-2 flex-1 group-open/summary:line-clamp-none">{read.summary}</span>
              <ChevronDown
                className="mt-0.5 size-4 shrink-0 text-ink-muted transition-transform group-open/summary:rotate-180"
                strokeWidth={1.75}
                aria-hidden
              />
            </summary>
            <span className="mt-2 block text-small font-medium text-ink-muted">Key points</span>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ui marker:text-ink-muted">
              {read.points.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
            <div className="-ml-2 mt-1">{press('Summarise again')}</div>
          </details>
        </div>
      )}
      {/* A div, not a p: the facts and Remove make room for the confirm's own p. */}
      {state.error && !pending && (
        <div role="alert" className="w-full pl-5.5 text-small text-danger">
          Not summarised: {state.error}
        </div>
      )}
    </li>
  );
}

/**
 * The press under the syllabus that has Dash lay out the course's weeks
 * (plan #2401.6), with its cost shown first. After a first read it reads the
 * syllabus again, and says that weeks changed by hand stay as they are.
 */
function LayOutWeeks({
  courseId,
  again,
  error,
  reading,
}: {
  courseId: string;
  again: boolean;
  error?: string;
  reading: boolean;
}) {
  const toast = useToast();
  const [state, read, pendingRead] = useActionState<ReadSyllabusWeeksState, FormData>(
    async (prev, form) => {
      const next: ReadSyllabusWeeksState = await readSyllabusWeeksAction(prev, form).catch(() => ({
        error: 'The syllabus could not be read. Try again.',
      }));
      if (next.laidOut) toast({ text: `Laid out ${next.laidOut} ${next.laidOut === 1 ? 'week' : 'weeks'} from the syllabus.` });
      return next;
    },
    error ? { error } : {},
  );
  const pending = pendingRead || reading;
  return (
    <div className="pl-5.5">
      <form action={read} className="flex flex-wrap items-center gap-x-2">
        <input type="hidden" name="courseId" value={courseId} />
        <DashAction
          type="submit"
          size="xs"
          variant="ghost"
          className="-ml-1.5"
          pending={pending}
          paid="app/you/work/actions.ts#readSyllabusWeeksAction"
          what="Cost of laying out the weeks"
        >
          {pending ? 'Reading the weeks…' : again ? 'Read the weeks again' : 'Lay out the weeks'}
        </DashAction>
        {again && !pending && (
          <span className="text-small text-ink-muted">Weeks you changed stay as you left them.</span>
        )}
      </form>
      {state.error && !pending && (
        <div role="alert" className="text-small text-danger">
          {again ? `Not read again, so the weeks below are as they were. ${state.error}` : `Not laid out: ${state.error}`}
        </div>
      )}
    </div>
  );
}

/**
 * A week laid out from the syllabus: its number and its topic, with Edit,
 * which shows on hover and focus and always on a phone. Editing changes the
 * topic or removes the week; either marks it so a second read leaves it be.
 */
function WeekHeading({ group, slot, editing: initialEditing }: { group: CourseFileGroup; slot: CourseWeek; editing: boolean }) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(initialEditing);
  const [title, setTitle] = useState(slot.title ?? '');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (which: 'save' | 'remove') => {
    setBusy(which);
    setProblem(null);
    const form = new FormData();
    form.set('id', slot.id);
    form.set('title', title);
    const done = await (which === 'save' ? renameCourseWeekAction(form) : removeCourseWeekAction(form)).catch(() => ({
      ok: false as const,
      error: 'That did not go through. Try again.',
    }));
    setBusy(null);
    if (!done.ok) {
      setProblem(done.error);
      return;
    }
    toast({
      text:
        which === 'save'
          ? `Saved week ${slot.week}.`
          : `Removed week ${slot.week}. Reading the syllabus again leaves it out.`,
    });
    setEditing(false);
    router.refresh();
  };

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 py-0.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run('save');
        }}
      >
        <h4 className="shrink-0 text-small font-medium text-ink-muted">
          <label htmlFor={`${id}-title`}>{group.label}</label>
        </h4>
        {/* The topic is edited in place at the heading's own size (law 12),
          * underlined rather than boxed, and only as wide as a topic needs.
          * The PressLabel gives the field a 44px press area on a phone. */}
        <div className="relative min-w-0 flex-1 basis-40 sm:max-w-sm">
          <PressLabel htmlFor={`${id}-title`} />
          <InlineInput
            id={`${id}-title`}
            value={title}
            maxLength={200}
            placeholder="Topic"
            autoFocus={!initialEditing}
            className="relative rounded-none border-b-border sm:text-small"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <Button type="submit" size="sm" pending={busy === 'save'} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            pending={busy === 'remove'}
            disabled={busy !== null}
            onClick={() => void run('remove')}
          >
            {busy === 'remove' ? 'Removing…' : 'Remove week'}
          </Button>
        </div>
        {problem && (
          <div role="alert" className="w-full text-small text-danger">
            {problem}
          </div>
        )}
      </form>
    );
  }

  return (
    <div className="group/week flex items-center gap-2">
      {/* One line at every width: a long topic is cut at the end and shown whole in its title and editor. */}
      <h4 className="min-w-0 truncate text-small font-medium text-ink-muted" title={slot.title ?? undefined}>
        {group.label}
        {slot.title && <span className="font-normal text-ink"> · {slot.title}</span>}
      </h4>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`Edit week ${slot.week}`}
        className="shrink-0 sm:opacity-0 sm:transition-opacity sm:group-hover/week:opacity-100 sm:focus-visible:opacity-100"
        onClick={() => setEditing(true)}
      >
        Edit
      </Button>
    </div>
  );
}

/** A kind to start a chosen file on, guessed from its name. */
function guessKind(name: string): CourseFileKind {
  const lower = name.toLowerCase();
  if (/syllab|course outline|course guide/.test(lower)) return 'syllabus';
  if (/\.pptx$/.test(lower) || /slide|lecture/.test(lower)) return 'slides';
  if (/notes?\b/.test(lower)) return 'lecture_notes';
  return 'reading';
}

/** A week to start a chosen file on, read from a name like "Week 3" or "Lecture_04". */
function guessWeek(name: string): string {
  const match = /(?:week|wk|lecture|lec)[\s_-]*0*(\d{1,2})/i.exec(name);
  return match && Number(match[1]) <= 60 ? String(Number(match[1])) : '';
}

function AddFiles({
  courseId,
  courseTitle,
  held,
  slots,
  initial,
  initialUploading,
  onClose,
}: {
  courseId: string;
  courseTitle: string;
  held: number;
  /** The weeks laid out from the syllabus, offered by name in each file's week (plan #2401.6). */
  slots: CourseWeek[];
  initial?: ChosenFile[];
  initialUploading: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const next = useRef(initial?.length ?? 0);
  const [rows, setRows] = useState<ChosenFile[]>(initial ?? []);
  const [uploading, setUploading] = useState(initialUploading);
  const [added, setAdded] = useState(0);

  const patch = (key: number, change: Partial<ChosenFile>) =>
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const choose = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setRows((current) => {
      const all = [
        ...current,
        ...picked.map((file) => ({
          key: next.current++,
          name: file.name,
          size: file.size,
          file,
          kind: guessKind(file.name),
          week: guessWeek(file.name),
          problem: null,
          refused: false,
          progress: null,
        })),
      ];
      // Refusals are worked out across the whole list, so the twentieth place goes to the first chosen.
      const reasons = refuseCourseFiles(all, held + added);
      return all.map((row, index) => ({
        ...row,
        refused: reasons[index] !== null,
        problem: reasons[index] ?? (row.refused ? null : row.problem),
      }));
    });
  };

  const sendable = rows.filter((row) => !row.refused && row.progress !== 1);

  const upload = async () => {
    setUploading(true);
    let kept = 0;
    for (const row of sendable) {
      const week = parseWeek(row.week);
      if (!week.ok) {
        patch(row.key, { problem: 'A week is a number from 0 to 60.' });
        continue;
      }
      const contentType = courseFileContentType(row.name);
      if (!row.file || !contentType) {
        patch(row.key, { problem: 'Not a file the course can keep.', refused: true });
        continue;
      }
      patch(row.key, { problem: null, progress: 0 });
      const sent = await uploadCourseFile(courseId, row.file, contentType, (fraction) =>
        patch(row.key, { progress: Math.min(fraction, 0.99) }),
      );
      if ('error' in sent) {
        patch(row.key, { problem: sent.error, progress: null });
        continue;
      }
      // The action removes the stored file itself when the row cannot be written.
      const saved = await addCourseFileAction({
        courseId,
        path: sent.path,
        fileName: row.name,
        sizeBytes: row.size,
        kind: row.kind,
        week: row.week,
      }).catch(() => ({ ok: false as const, error: 'The file was not saved. Try again.' }));
      if (!saved.ok) {
        patch(row.key, { problem: saved.error, progress: null });
        continue;
      }
      kept += 1;
      patch(row.key, { progress: 1 });
    }
    setUploading(false);
    setAdded((n) => n + kept);
    if (kept > 0) {
      toast({ text: `Added ${kept} ${kept === 1 ? 'file' : 'files'} to ${courseTitle}.` });
      router.refresh();
    }
    // Keep only the rows still to deal with; close once nothing is left.
    setRows((list) => {
      const left = list.filter((row) => row.progress !== 1);
      if (left.length === 0 && kept > 0) onClose();
      return left;
    });
  };

  const count = sendable.length;

  return (
    <div className="mt-2 space-y-3 rounded-card bg-sunken p-3">
      <div>
        {/* The browser's own file control says "No file chosen" beside a list
          * of chosen files, so the input is hidden and its label is the button. */}
        <label
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'cursor-pointer focus-within:outline-2 focus-within:outline-offset-2',
            uploading && 'pointer-events-none opacity-50',
          )}
        >
          <input
            id={`${id}-files`}
            type="file"
            multiple
            accept={COURSE_FILE_ACCEPT}
            disabled={uploading}
            aria-describedby={`${id}-hint`}
            className="sr-only"
            onChange={(e) => {
              choose(e.target.files);
              e.target.value = '';
            }}
          />
          {rows.length > 0 ? 'Add more files' : 'Choose files'}
        </label>
        <p id={`${id}-hint`} className="mt-1 text-small text-ink-muted">
          {COURSE_FILE_HINT}
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <ChosenRow
              key={row.key}
              row={row}
              idBase={`${id}-${row.key}`}
              slots={slots}
              locked={uploading}
              onChange={(change) => patch(row.key, change)}
              onLeaveOut={() => setRows((list) => list.filter((r) => r.key !== row.key))}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" pending={uploading} disabled={count === 0} onClick={upload}>
          {uploading ? 'Uploading…' : count === 1 ? 'Upload 1 file' : count === 0 ? 'Upload' : `Upload ${count} files`}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={uploading}>
          {rows.length > 0 ? 'Cancel' : 'Close'}
        </Button>
      </div>
    </div>
  );
}

function ChosenRow({
  row,
  idBase,
  slots,
  locked,
  onChange,
  onLeaveOut,
}: {
  row: ChosenFile;
  idBase: string;
  slots: CourseWeek[];
  locked: boolean;
  onChange: (change: Partial<ChosenFile>) => void;
  onLeaveOut: () => void;
}) {
  const going = row.progress !== null && row.progress < 1;
  const wide = useWide();
  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        {/* A refused file's name wraps, so the extension the refusal is about shows. */}
        <span
          className={cn(
            'min-w-0 flex-1 text-body font-medium text-ink',
            row.refused ? 'line-clamp-2 break-words' : 'truncate',
          )}
        >
          {row.name}
        </span>
        <span className="shrink-0 text-small tabular-nums text-ink-muted">{courseFileSize(row.size)}</span>
        {!locked && (
          <Button type="button" size="xs" variant="ghost" onClick={onLeaveOut}>
            Leave out
          </Button>
        )}
      </div>
      {row.refused ? (
        <p className="mt-0.5 text-small text-danger">Not added: {row.problem}</p>
      ) : (
        <>
          {locked ? (
            // While the files go up, the kind and week are facts, not a form.
            <p className="mt-0.5 text-small text-ink-muted">
              {[COURSE_FILE_KIND_LABELS[row.kind], chosenWeekLabel(slots, row.week)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : (
            // The kind and the week share one line at every width, the kind narrow and the week taking the rest.
            <div className="mt-1 flex items-center gap-2">
              {/* Each field has no visible label, so a PressLabel gives it a 44px press area on a phone. */}
              <div className={cn('relative min-w-0', slots.length > 0 ? 'shrink-0 sm:w-40' : 'flex-1 sm:w-48 sm:flex-none')}>
                <PressLabel htmlFor={`${idBase}-kind`} />
                <Select
                  id={`${idBase}-kind`}
                  aria-label={`What ${row.name} is`}
                  value={row.kind}
                  // The guessed kind is quieter than the file it describes. Beside the
                  // week it is only as wide as the kind it shows, so the week's name reads.
                  className={cn(
                    'relative text-ink-muted',
                    slots.length > 0 ? 'w-auto [field-sizing:content] sm:w-full' : 'w-full',
                  )}
                  onChange={(e) => onChange({ kind: e.target.value as CourseFileKind })}
                >
                  {COURSE_FILE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {COURSE_FILE_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              </div>
              {slots.length > 0 ? (
                // With the syllabus's weeks laid out, the week is picked by name, its
                // topic cut to fit: a word or two beside the kind on a phone, more from laptop width.
                <div className="relative min-w-0 flex-1">
                  <PressLabel htmlFor={`${idBase}-week`} />
                  <Select
                    id={`${idBase}-week`}
                    aria-label={`Week of ${row.name}`}
                    value={row.week.trim()}
                    className="relative w-full text-ink-muted"
                    onChange={(e) => onChange({ week: e.target.value })}
                  >
                    <option value="">No week</option>
                    {weekChoices(slots, row.week).map((choice) => (
                      <option key={choice.week} value={String(choice.week)}>
                        {weekName({ week: choice.week, title: shortTopic(choice.title, wide ? 32 : 12) })}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
              <div className="relative w-20">
                <PressLabel htmlFor={`${idBase}-week`} />
                <Input
                  id={`${idBase}-week`}
                  aria-label={`Week of ${row.name}`}
                  inputMode="numeric"
                  maxLength={2}
                  value={row.week}
                  placeholder="Week"
                  className="relative w-full text-ink-muted"
                  onChange={(e) => onChange({ week: e.target.value })}
                />
              </div>
              )}
            </div>
          )}
          {going && (
            <Meter
              value={row.progress ?? 0}
              max={1}
              moves
              track="canvas"
              label={`${row.name}: ${Math.round((row.progress ?? 0) * 100)}% uploaded`}
              className="mt-2"
            />
          )}
          {row.problem && <p className="mt-1 text-small text-danger">Not added: {row.problem}</p>}
          {locked && !row.problem && row.progress === null && (
            <p className="mt-1 text-small text-ink-muted">Waiting its turn</p>
          )}
        </>
      )}
    </li>
  );
}

const WIDE = '(min-width: 640px)';

/** Whether the page is at least the sm width, for text a select cannot cut with CSS. */
function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** The weeks a chosen file can go in: the syllabus's, and a week guessed from its name that the syllabus lacks. */
function weekChoices(slots: CourseWeek[], current: string): Array<Pick<CourseWeek, 'week' | 'title'>> {
  const parsed = parseWeek(current);
  const choices: Array<Pick<CourseWeek, 'week' | 'title'>> = [...slots];
  if (parsed.ok && parsed.week !== null && !slots.some((slot) => slot.week === parsed.week)) {
    choices.push({ week: parsed.week, title: null });
  }
  return choices.sort((a, b) => a.week - b.week);
}

/**
 * A topic short enough for the week select to show whole on a phone: a long
 * one ends after its last whole word that fits, with an ellipsis, never
 * mid-word.
 */
function shortTopic(title: string | null, max = 24): string | null {
  if (!title || title.length <= max) return title;
  const cut = title.slice(0, max + 1);
  const end = cut.lastIndexOf(' ');
  return `${(end > 0 ? cut.slice(0, end) : title.slice(0, max)).replace(/[\s,:;·-]+$/, '')}…`;
}

/** A chosen file's week while it uploads, by name where the syllabus gives one. */
function chosenWeekLabel(slots: CourseWeek[], value: string): string | null {
  const parsed = parseWeek(value);
  if (!parsed.ok || parsed.week === null) return null;
  const slot = slots.find((s) => s.week === parsed.week);
  return slot ? weekName(slot) : `Week ${parsed.week}`;
}
