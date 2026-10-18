'use client';

import { useActionState } from 'react';
import { DashAction } from '@/components/ui/dash-action';
import { useToast } from '@/components/ui/toast';
import { noteHref } from '@/lib/vault/paths';
import {
  newerSummaries,
  OVERVIEW_MIN_READ,
  readFiles,
  type CourseNote,
  type CourseOverview,
} from '@/lib/you/course-overview';
import { COURSE_FILE_KIND_LABELS, type CourseFile } from '@/lib/you/transcripts';
import { collectCourseOverviewAction, type CollectCourseOverviewState } from './actions';

/**
 * The block at the head of a course's files (plan #2401.7): what the course
 * was about and the ideas that came back in more than one file, in Dash's
 * words on the recessed ground, then the person's own notes that name the
 * course, as links in their own type.
 *
 * Dash writes it only on a press, at the cost its hint shows (decision
 * #2401.3), from the summaries of the files already read, and says how many
 * of the course's files that was. Under two read files the block says how
 * many more are needed instead.
 */
export function CourseOverviewBlock({
  courseId,
  files,
  overview,
  notes,
  collecting = false,
  error,
  costOpen = false,
}: {
  courseId: string;
  files: CourseFile[];
  overview: CourseOverview | null;
  notes: CourseNote[];
  /** The gallery's way to draw the block mid-read. */
  collecting?: boolean;
  /** The gallery's way to draw a failed read. */
  error?: string;
  /** The gallery's way to draw the cost hint open, as hover shows it. */
  costOpen?: boolean;
}) {
  const toast = useToast();
  const [state, collect, pendingCollect] = useActionState<CollectCourseOverviewState, FormData>(
    async (prev, form) => {
      const next: CollectCourseOverviewState = await collectCourseOverviewAction(prev, form).catch(() => ({
        error: 'The summaries could not be read. Try again.',
      }));
      if (next.collected) toast({ text: 'Dash pulled the course together.' });
      return next;
    },
    error ? { error } : {},
  );
  const pending = pendingCollect || collecting;
  const read = readFiles(files).length;
  const need = Math.max(0, OVERVIEW_MIN_READ - read);
  const byId = new Map(files.map((file) => [file.id, file]));
  const newer = overview ? newerSummaries(files, overview) : 0;

  const press = (label: string) => (
    <form action={collect}>
      <input type="hidden" name="courseId" value={courseId} />
      <DashAction
        type="submit"
        size="xs"
        variant="ghost"
        className="-ml-1.5"
        pending={pending}
        paid="app/you/work/actions.ts#collectCourseOverviewAction"
        what="Cost of pulling the course together"
        hintOpen={costOpen}
      >
        {pending ? 'Pulling it together…' : label}
      </DashAction>
    </form>
  );

  const failed = state.error && !pending && (
    <div role="alert" className="mt-1 text-small text-danger">
      {overview ? `Not pulled together again, so this is as it was. ${state.error}` : `Not pulled together: ${state.error}`}
    </div>
  );

  if (files.length === 0) return null;

  return (
    <section aria-label="The course as a whole" className="mb-3">
      {overview ? (
        // Dash's words sit on the recessed ground (voice-dash), apart from the files and the notes.
        <div className="voice-dash max-w-prose px-2.5 py-2">
          <h4 className="text-small font-medium text-ink-muted">What the course was about</h4>
          <div className="mt-0.5 text-ui">{overview.about}</div>
          {overview.recurring.length > 0 && (
            <>
              <h4 className="mt-2 text-small font-medium text-ink-muted">Came back more than once</h4>
              <ul className="mt-0.5 list-disc space-y-1 pl-4 text-ui marker:text-ink-muted">
                {overview.recurring.map((idea, index) => {
                  const where = idea.file_ids.flatMap((id) => {
                    const file = byId.get(id);
                    return file ? [fileLabel(file)] : [];
                  });
                  return (
                    <li key={index}>
                      {idea.idea}
                      {where.length > 0 && (
                        <span className="block text-small text-ink-muted">{where.join(' · ')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-small text-ink-muted">
              {readFromLine(overview.file_ids.length, files.length)}
              {newer > 0 && ` ${newer === 1 ? 'One file was' : `${newer} files were`} summarised since.`}
            </span>
            {press('Pull it together again')}
          </div>
          {/* A failed second read answers the press above it, inside the block it left as it was. */}
          {failed}
        </div>
      ) : need > 0 ? (
        <div className="text-small text-ink-muted">{needLine(read, need, files.length)}</div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {press('Pull the course together')}
          {!pending && (
            <span className="text-small text-ink-muted">
              What it was about and what came back, from the {read === files.length ? `${read} files` : `${read} of ${files.length} files`} read.
            </span>
          )}
        </div>
      )}
      {!overview && failed}
      {notes.length > 0 && (
        <div className="mt-3">
          <h4 className="text-small font-medium text-ink-muted">In your notes</h4>
          <ul className="mt-0.5 space-y-1">
            {notes.map((note) => (
              <li key={note.id} className="min-w-0">
                <a href={noteHref(note.path)} className="press-area text-body text-ink hover:text-accent">
                  {note.title}
                </a>
                {note.excerpt && <span className="block truncate text-small text-ink-muted">{note.excerpt}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "Week 2 reading", or the kind alone for a file with no week. */
function fileLabel(file: CourseFile): string {
  const kind = COURSE_FILE_KIND_LABELS[file.kind];
  return file.week === null ? kind : `Week ${file.week} ${kind.toLowerCase()}`;
}

function readFromLine(from: number, total: number): string {
  if (from >= total) return `Read from all ${from} files.`;
  return `Read from ${from} of ${total} files, so it leaves out the rest.`;
}

/** What the block says before two files are read. */
function needLine(read: number, need: number, total: number): string {
  if (read === 0) {
    return 'Dash has not read any of these yet. Summarise a file and its summary and key points stay under it. With two read, Dash can say what the course was about.';
  }
  const more = need === 1 ? 'one more file' : `${need} more files`;
  if (total < OVERVIEW_MIN_READ) return `Add and summarise ${more} and Dash can say what the course was about and what came back.`;
  return `Summarise ${more} and Dash can say what the course was about and what came back.`;
}
