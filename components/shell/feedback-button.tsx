'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import {
  flipFiled,
  openFeedbackCount,
  submitFeedback,
  triageFiled,
  type FeedbackActionState,
} from '@/app/dev/bugs/actions';
import { shapeIdea } from '@/app/dev/ideas/actions';
import { AddFile } from '@/components/attachments/add-file';
import { Button } from '@/components/ui/button';
import { RunRoutineButton } from '@/components/feedback/run-routine-button';
import { TriageNote } from '@/components/feedback/triage-note';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import { Popover } from '@/components/ui/popover';
import { IconButton } from '@/components/ui/icon-button';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import type { FeedbackKind } from '@/lib/feedback/load';
import type { FiledAs } from '@/lib/feedback/move';
import type { TriageView } from '@/lib/feedback/triage';
import { usePopover } from '@/lib/use-popover';

/**
 * Always-available capture for bugs, requests and ideas.
 *
 * It lives in the header so the thought can be written down where it occurs,
 * and it records the page you were on — half of every bug report is "where
 * were you when it happened", and that half is free.
 *
 * One box (plan #1675). There were "Bug or feature" and "Idea" tabs, and
 * which of the two a thought was is not something anybody should have to
 * decide while having it. Everything is saved as a note first. Triage then
 * answers fix or plan (plan #1674), and a note it is sure needs planning is
 * moved to the ideas page by the server (`triageFiled`): an idea is written
 * from the same text and the note is marked planned, naming it. The saved
 * panel says which it became, with one press to move it the other way.
 *
 * There was a Like tab too, and it is gone (note f36f9542): recording what
 * works was not something anybody wanted to do from here. Likes already filed
 * stay in the queue as they were, for the vision review to read.
 *
 * The owner gets the filed line, the flip and the routine section. Everybody
 * else files a note and is told it saved: the ideas page and the queue's
 * controls are the owner's alone (see `isOwner` below).
 */

/** The kind a note files as: a request, until triage says it is a bug. */
const NOTE_KIND: FeedbackKind = 'feature';

/** Where the note just saved now is, once triage has answered. */
type Placement = { noteId: string; as: FiledAs; ideaId: string | null };

export function FeedbackButton({
  allHref = '/dev/bugs',
  isOwner = false,
  initialOpen = false,
  initialFiles = [],
  initialSaved = null,
}: {
  allHref?: string;
  /**
   * Whether the signed-in account owns this app. Passed down from the shell,
   * which read it once on the server: the check is server-only and costs a
   * round trip, so a client component may not ask for itself.
   *
   * It decides how much of this panel there is. Everyone gets the capture --
   * a bug is a bug whoever hit it -- and the rest of what is in here is the
   * dev workspace poking through the header: the move to the ideas page
   * writes to a list only the owner can see, and the routine section below
   * the form is the notes queue's own controls.
   *
   * Omitted means "not the owner": the smaller panel, which files a note and
   * says so, rather than one offering buttons whose actions would refuse.
   */
  isOwner?: boolean;
  /** For the gallery, which draws the panel open with a file added. */
  initialOpen?: boolean;
  initialFiles?: UploadedAttachment[];
  /**
   * For the gallery, which draws the panel just after a note saved, with
   * Jev's triage under it and where it was filed (plans #1674, #1675). Gone
   * once anything is filed.
   */
  initialSaved?: { filedAs: FiledAs; triage: TriageView } | null;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(initialOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [state, action, pending] = useActionState(submitFeedback, {} as FeedbackActionState);

  // The files going with the next note (plan #1713): uploaded as they are
  // chosen, recorded against the note when it saves, and cleared once it
  // has. Kept while the panel is shut, so closing it by mistake does not
  // lose a screenshot already sent up. Send waits while one is uploading.
  const [files, setFiles] = useState<UploadedAttachment[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [settledNote, setSettledNote] = useState<FeedbackActionState | null>(null);
  if (state.filed && state !== settledNote) {
    setSettledNote(state);
    setFiles([]);
  }

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  // What Jev made of the note just saved (plan #1179), asked for once the
  // save has returned so Send never waits on it, and where the note now is:
  // still a note, or moved to the ideas page because triage was sure it needs
  // planning (plan #1675). Keyed on the row's id, so a second note replaces
  // the first one's answer.
  const filedId = state.filed?.id ?? null;
  const filedTable = state.filed?.table ?? null;
  const [triage, setTriage] = useState<{ id: string; view: TriageView | null } | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(
    initialSaved
      ? {
          noteId: 'preview',
          as: initialSaved.filedAs,
          ideaId: initialSaved.filedAs === 'idea' ? 'preview' : null,
        }
      : null,
  );
  useEffect(() => {
    if (!filedId || !filedTable) return;
    let cancelled = false;
    const settle = (view: TriageView | null, ideaId: string | null) => {
      if (cancelled) return;
      setTriage({ id: filedId, view });
      setPlacement({ noteId: filedId, as: ideaId ? 'idea' : 'note', ideaId });
    };
    void triageFiled({ table: filedTable, id: filedId, pagePath: pathname })
      .then((result) => settle(result?.view ?? null, result?.ideaId ?? null))
      .catch(() => settle(null, null));
    return () => {
      cancelled = true;
    };
    // The page it was filed from, read when it saved rather than tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filedId, filedTable]);
  const triaged = filedId !== null && triage?.id === filedId ? triage.view : null;
  const triaging = Boolean(filedId && triage?.id !== filedId);
  const saved = filedId === null ? initialSaved : null;
  const placed =
    filedId === null
      ? saved && placement
      : placement?.noteId === filedId
        ? placement
        : null;

  // Counted when the panel opens, and again after a note is filed from it, so
  // the number beside "Run Feature Routine" is the queue as it stands rather
  // than as it was when the layout was rendered. A failure leaves it unknown,
  // and the button simply shows no count.
  const [openCount, setOpenCount] = useState<number | null>(null);
  const submitted = state.message;
  useEffect(() => {
    // The count is the owner's queue, and `openFeedbackCount` is locked to
    // them (#417). Not fetched at all for anyone else, rather than fetched and
    // swallowed: the number has nowhere to go once the section below the form
    // is gone.
    if (!open || !isOwner) return;
    let cancelled = false;
    void openFeedbackCount()
      .then((count) => {
        if (!cancelled) setOpenCount(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, submitted, isOwner, placed?.as]);

  return (
    <div className="relative shrink-0">
      <IconButton
        ref={triggerRef}
        label="Report a bug, request a feature, or note an idea"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        active={open}
        className={open ? undefined : 'text-shell-muted hover:bg-shell-hover hover:text-shell-ink'}
      >
        <MessageSquarePlus strokeWidth={1.75} aria-hidden />
      </IconButton>

      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Send feedback"
          tabIndex={-1}
          padding="panel"
          className="sm:w-88"
        >
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="page_path" value={pathname} />
            <input
              type="hidden"
              name="user_agent"
              value={typeof navigator === 'undefined' ? '' : navigator.userAgent}
            />
            <input type="hidden" name="kind" value={NOTE_KIND} />

            <div>
              <Label htmlFor="feedback_body">What is on your mind?</Label>
              <Textarea
                id="feedback_body"
                name="body"
                rows={4}
                required
                placeholder={
                  isOwner
                    ? 'A bug, a change, or an idea. Dash files it as a note or an idea for you.'
                    : 'What went wrong, or what it should do.'
                }
              />
              <p className="mt-1 text-small text-ink-muted">
                Saved with the page you are on ({pathname}).
              </p>
            </div>

            <AddFile
              name="attachments"
              value={files}
              onChange={setFiles}
              disabled={pending}
              onUploadingChange={setUploading}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" pending={pending} disabled={uploading}>
                {pending ? 'Saving…' : 'Send'}
              </Button>
            </div>

            <FieldError>{state.error}</FieldError>
            {isOwner && placed ? (
              <FiledLine
                key={placed.noteId}
                placement={placed}
                onMoved={setPlacement}
              />
            ) : (
              state.message && (
                <p className="text-ui text-accent">
                  {state.message}
                  {triaging && isOwner && ' Sorting it…'}
                </p>
              )
            )}
            <TriageNote view={triaged ?? saved?.triage ?? null} onNavigate={() => setOpen(false)} />
          </form>

          {/* Its own section below the form, not a link on the Send row: it is
              the other thing you can do from here, and it acts on the whole
              queue rather than on what you just typed. All of it the owner's:
              the routine, the count and the way through land in /dev, which
              another account cannot open at all (#416). */}
          {isOwner && (
            <div className="mt-4">
              <RunRoutineButton
                openCount={openCount}
                allHref={allHref}
                onNavigate={() => setOpen(false)}
              />
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

/**
 * Where the note just saved went, with one press to move it the other way
 * (plan #1675), and, for an idea, "Shape it now" beneath: the same hand-off
 * as Shape on the ideas page, for an idea you already know you want shaped.
 */
function FiledLine({
  placement,
  onMoved,
}: {
  placement: Placement;
  onMoved: (next: Placement) => void;
}) {
  const [moving, startMove] = useTransition();
  const [shaping, startShape] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [shaped, setShaped] = useState<string | null>(null);
  const idea = placement.as === 'idea';

  const flip = () =>
    startMove(async () => {
      setError(null);
      const to: FiledAs = idea ? 'note' : 'idea';
      const result = await flipFiled({ noteId: placement.noteId, ideaId: placement.ideaId, to });
      if (result.error) setError(result.error);
      else onMoved({ ...placement, as: to, ideaId: result.ideaId ?? placement.ideaId });
    });

  const shape = () =>
    startShape(async () => {
      if (!placement.ideaId) return;
      setError(null);
      const form = new FormData();
      form.set('id', placement.ideaId);
      const result = await shapeIdea({}, form);
      if (result.error) setError(result.error);
      else setShaped(result.message ?? 'Sent.');
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ui text-accent">{idea ? 'Filed as an idea.' : 'Filed as a note.'}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          pending={moving}
          disabled={shaping || Boolean(shaped)}
          onClick={flip}
        >
          {idea ? 'Move to notes' : 'Move to ideas'}
        </Button>
      </div>
      {idea &&
        (shaped ? (
          <p className="text-small text-ink-muted">{shaped}</p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pending={shaping}
            disabled={moving || !placement.ideaId}
            onClick={shape}
          >
            Shape it now
          </Button>
        ))}
      <FieldError>{error}</FieldError>
    </div>
  );
}
