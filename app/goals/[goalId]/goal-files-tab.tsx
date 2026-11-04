'use client';

import { useId, useRef, useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { FileSheet } from '@/components/files/file-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineInput } from '@/components/ui/field';
import { LiveDot } from '@/components/ui/live-dot';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/auth/client';
import { cn } from '@/lib/cn';
import { fileHref } from '@/lib/files/files';
import { DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, documentContentType, documentPath } from '@/lib/goals/extract';
import type { GoalFileRow } from '@/lib/goals/goal-files';
import {
  FILE_VIEWS,
  emptyViewLine,
  fileTypeLabel,
  filesInView,
  viewCounts,
  workCount,
  type FileView,
  type WaitingRow,
  type WorkEntry,
} from '@/lib/goals/goal-files-tab';
import {
  addGoalFileAction,
  pinGoalFileAction,
  removeGoalFileAction,
  renameGoalFileAction,
} from './goal-file-actions';

/**
 * The Work & files tab (plan #2778.7), as the approved loans mockup draws it
 * (docs/references/goal-dashboard/loans.html, "Work & files"): a Files card
 * with All, Dash wrote, Yours and Waiting for, a drop zone at its foot, and
 * beside it from wide laptop width a card of every piece of work Dash took on
 * for the goal, each folded to its question and day.
 *
 * A dropped or chosen file goes straight from the browser to your folder of
 * the goals-documents bucket, as a form's document does, and the action then
 * keeps it on the step it belongs to.
 */

export type TabFile = GoalFileRow & {
  /** "Dash · 2 Nov · for “Apply for IBR”". */
  meta: string;
};

export type TabWork = WorkEntry & { day: string };

export type Uploading = { name: string; contentType?: string | null };

const EMPTY_TITLES: Record<FileView, string> = {
  all: 'No files yet',
  dash: 'Nothing from Dash yet',
  yours: 'Nothing of yours yet',
  waiting: 'Nothing waiting',
};

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.txt,.csv,.html,.htm';

export function GoalFilesTab({
  goalId,
  files,
  waiting,
  work,
  canAdd = true,
  defaultView = 'all',
  defaultDragging = false,
  defaultUploading = null,
  defaultMenuFor = null,
}: {
  goalId: string;
  files: TabFile[];
  waiting: WaitingRow[];
  work: TabWork[];
  canAdd?: boolean;
  /** For the gallery: each hidden part drawn showing. */
  defaultView?: FileView;
  defaultDragging?: boolean;
  defaultUploading?: Uploading | null;
  defaultMenuFor?: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
      <FilesCard
        goalId={goalId}
        files={files}
        waiting={waiting}
        canAdd={canAdd}
        defaultView={defaultView}
        defaultDragging={defaultDragging}
        defaultUploading={defaultUploading}
        defaultMenuFor={defaultMenuFor}
      />
      <WorkCard work={work} />
    </div>
  );
}

function FilesCard({
  goalId,
  files,
  waiting,
  canAdd,
  defaultView,
  defaultDragging,
  defaultUploading,
  defaultMenuFor,
}: {
  goalId: string;
  files: TabFile[];
  waiting: WaitingRow[];
  canAdd: boolean;
  defaultView: FileView;
  defaultDragging: boolean;
  defaultUploading: Uploading | null;
  defaultMenuFor: string | null;
}) {
  const [view, setView] = useState<FileView>(defaultView);
  const [dragging, setDragging] = useState(defaultDragging);
  const [uploading, setUploading] = useState<Uploading | null>(defaultUploading);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const kindFor = useRef<string | null>(null);
  const inputId = useId();
  const counts = viewCounts(files, waiting.length);
  const unread = files.filter((file) => file.unread).length;
  const shown = view === 'waiting' ? [] : filesInView(files, view);

  const add = (list: FileList | File[] | null, kindId: string | null) => {
    const file = list && list[0];
    if (!file || uploading) return;
    setError(null);
    setUploading({ name: file.name, contentType: documentContentType(file.name) });
    startTransition(async () => {
      const uploaded = await upload(file);
      if ('error' in uploaded) {
        setError(uploaded.error);
        setUploading(null);
        return;
      }
      const result = await addGoalFileAction({
        goalId,
        path: uploaded.path,
        name: file.name,
        size: file.size,
        kindId,
      }).catch(() => ({ error: 'That file could not be kept. Try again.', placed: undefined }));
      setUploading(null);
      if (result.error) setError(result.error);
      else toast({ text: result.placed ?? 'Added to the goal.' });
    });
  };

  const choose = (kindId: string | null) => {
    kindFor.current = kindId;
    inputRef.current?.click();
  };

  return (
    <Card padding="none" className="min-w-0">
      <div className="card-pad-x flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3">
        <h2 id="files-heading" className="text-ui font-semibold text-ink">
          Files
        </h2>
        {files.length > 0 && (
          <span className="tabular text-small text-ink-muted">
            {files.length === 1 ? '1 file' : `${files.length} files`}
            {unread > 0 && ` · ${unread} unread`}
          </span>
        )}
      </div>
      <div className="card-pad-x pt-2 pb-1">
        <span role="group" aria-label="Which files" className="flex flex-wrap gap-1">
          {FILE_VIEWS.map((option) => {
            const on = option.value === view;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => setView(option.value)}
                className={cn(
                  'press press-area rounded-full px-2.5 py-0.5 text-small font-medium transition-colors duration-quick',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  on ? 'bg-ink text-surface' : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )}
              >
                {option.label}
                {option.value === 'waiting' && counts.waiting > 0 && (
                  <span className="tabular ml-1">{counts.waiting}</span>
                )}
              </button>
            );
          })}
        </span>
      </div>
      <ul aria-labelledby="files-heading" className="card-pad-x divide-y divide-border">
        {uploading && (
          <li className="row-pad flex items-center gap-3" aria-live="polite">
            <FileSheet label={fileTypeLabel(uploading.contentType ?? documentContentType(uploading.name))} tone="pending" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-ink">{uploading.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-small text-ink-muted">
                <LiveDot />
                You · just now · uploading
              </span>
            </span>
          </li>
        )}
        {shown.map((file) => (
          <FileRow key={file.fileId} goalId={goalId} file={file} menuOpen={defaultMenuFor === file.fileId} />
        ))}
        {/* All lists what is still waiting after the files, as Waiting for does alone. */}
        {(view === 'all' || view === 'waiting') &&
          waiting.map((row) => (
            <li key={row.kindId} className="row-pad flex items-center gap-3">
              <FileSheet label="Doc" tone="waiting" />
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-medium text-ink">{row.name}</span>
                <span className="mt-0.5 block text-small text-ink-muted">Waiting · for “{row.stepTitle}”</span>
              </span>
              {canAdd && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={Boolean(uploading)}
                  onClick={() => choose(row.kindId)}
                >
                  Add
                </Button>
              )}
            </li>
          ))}
        {!uploading && shown.length === 0 && (view === 'all' || view === 'waiting' ? waiting.length === 0 : true) && (
          <li className="row-pad flex items-center gap-3">
            <FileSheet label="+" tone="waiting" />
            <span className="min-w-0 flex-1">
              <span className="block text-ui font-medium text-ink">{EMPTY_TITLES[view]}</span>
              <span className="mt-0.5 block text-small text-ink-muted">{emptyViewLine(view)}</span>
            </span>
          </li>
        )}
      </ul>
      {canAdd && (
        <div className="card-pad-x pt-1 pb-3">
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              add(event.dataTransfer.files, null);
            }}
            className={cn(
              // ui-ok: hand-rolled-box -- a drop zone is a target for a dragged file, not a grouping, and EmptyState has no drag-over state
              'grid gap-0.5 rounded-control border border-dashed px-3 py-3 text-center text-small transition-colors duration-quick',
              dragging ? 'border-accent bg-accent-tint text-ink' : 'border-control text-ink-muted',
            )}
          >
            <span>{dragging ? 'Let go to add it to this goal' : 'Drop a PDF, a screenshot or a letter here'}</span>
            <span>
              <label htmlFor={inputId} className={cn('cursor-pointer', linkVariants())}>
                or choose a file
              </label>
              . Dash puts it on the step it belongs to.
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => {
                add(event.currentTarget.files, kindFor.current);
                kindFor.current = null;
                event.currentTarget.value = '';
              }}
            />
          </div>
          {error && (
            <p role="alert" className="mt-1.5 text-small text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function FileRow({ goalId, file, menuOpen }: { goalId: string; file: TabFile; menuOpen: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const fields = { goalId, fileId: file.fileId };
  const items: ActionMenuItem[] = [
    {
      id: 'pin',
      label: file.pinned ? 'Unpin' : 'Pin to the top',
      formAction: pinGoalFileAction,
      formFields: { ...fields, pinned: file.pinned ? 'false' : 'true' },
    },
    { id: 'rename', label: 'Rename', onSelect: () => setRenaming(true) },
    {
      id: 'remove',
      label: 'Remove from this goal',
      destructive: true,
      confirm: 'Remove it? It stays under Files for every goal.',
      formAction: removeGoalFileAction,
      formFields: fields,
    },
  ];
  if (renaming) {
    return (
      <li className="row-pad flex items-center gap-3">
        <FileSheet label={fileTypeLabel(file.contentType)} tone={file.byDash ? 'dash' : 'yours'} />
        <form
          action={async (form) => {
            await renameGoalFileAction(form);
            setRenaming(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <input type="hidden" name="goalId" value={goalId} />
          <input type="hidden" name="fileId" value={file.fileId} />
          <InlineInput
            name="title"
            defaultValue={file.title}
            aria-label="New name"
            maxLength={200}
            autoFocus
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      </li>
    );
  }
  return (
    // The menu takes room on the title's line only: the line of who, when
    // and which step runs the full width under it.
    <li className="relative">
      <Link
        href={fileHref(file.fileId)}
        className="row-pad flex min-w-0 items-center gap-3 transition-colors duration-quick hover:text-accent"
      >
        <FileSheet label={fileTypeLabel(file.contentType)} tone={file.byDash ? 'dash' : 'yours'} />
        <span className="min-w-0 flex-1">
          <span className="block pr-9 text-ui font-medium text-ink">
            {file.unread && (
              <span
                title="Not read yet"
                className="mr-1.5 inline-block size-2 -translate-y-px rounded-full bg-accent align-middle"
              >
                <span className="sr-only">Not read yet: </span>
              </span>
            )}
            {file.title}
          </span>
          <span className="mt-0.5 block text-small text-ink-muted">
            {file.pinned && <span className="font-semibold text-accent">Pinned · </span>}
            {file.meta}
          </span>
        </span>
      </Link>
      <ActionMenu
        label={`More for ${file.title}`}
        items={items}
        defaultOpen={menuOpen}
        className="absolute top-1.5 right-0"
      />
    </li>
  );
}

function WorkCard({ work }: { work: TabWork[] }) {
  const count = workCount(work);
  return (
    <Card padding="none" className="min-w-0">
      <div className="card-pad-x flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3 pb-1">
        <h2 id="work-heading" className="text-ui font-semibold text-ink">
          Dash’s work
        </h2>
        {count && <span className="tabular text-small text-ink-muted">{count}</span>}
      </div>
      {work.length === 0 ? (
        <p className="card-pad-x pt-1 pb-3 text-small text-ink-muted">
          Dash has not taken on anything for this goal yet. Ask it from the Dashboard.
        </p>
      ) : (
        <ul aria-labelledby="work-heading" className="card-pad-x divide-y divide-border">
          {work.map((entry, index) => (
            <li key={entry.runId} id={`work-${entry.runId}`}>
              <Disclosure
                defaultOpen={index === 0 && entry.state === 'running'}
                summaryClassName="row-pad items-baseline [&>span:first-of-type]:flex-1 [&>svg]:hidden"
                bodyClassName="-mt-1 pb-3"
                title={
                  <span className="inline-flex items-baseline gap-2">
                    {entry.state === 'running' && <LiveDot className="translate-y-[-1px]" />}
                    <span>{entry.title}</span>
                  </span>
                }
                meta={
                  <span className="tabular whitespace-nowrap">
                    {entry.state === 'failed' && <span className="text-danger">Stopped · </span>}
                    {entry.day}
                  </span>
                }
              >
                <div className="space-y-1 text-small">
                  {entry.result && (
                    <p className={entry.state === 'failed' ? 'text-danger' : 'text-ink'}>
                      {entry.state === 'running' ? `Going: ${entry.result}` : entry.result}
                    </p>
                  )}
                  <p className="text-ink-muted">
                    {entry.startedFrom}
                    {entry.file && (
                      <>
                        {' · '}
                        <Link href={fileHref(entry.file.fileId)} className={linkVariants()}>
                          {entry.file.title}
                        </Link>
                      </>
                    )}
                    {' · '}
                    <Link href={`/goals/runs/${entry.runId}`} className={linkVariants({ tone: 'quiet' })}>
                      Details
                    </Link>
                  </p>
                </div>
              </Disclosure>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Put the file in your folder of the bucket, under a fresh name. */
async function upload(file: File): Promise<{ path: string } | { error: string }> {
  const contentType = documentContentType(file.name);
  if (!contentType) {
    return { error: 'That kind of file cannot be kept. Use a PDF, an image, a Word file or text.' };
  }
  if (file.size > DOCUMENT_MAX_BYTES) return { error: 'That file is over 20 MB.' };
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = documentPath(data.user.id, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) return { error: 'That file could not be uploaded. Try again.' };
  return { path };
}
