'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Maximize2, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import { popoverSurface, scrim } from '@/components/ui/popover';

/**
 * A piece of writing, read until you go to edit it.
 *
 * `InlineInput` is this for one line and has been in the app for a while. This
 * is the same law one size up, for the things that are actually paragraphs --
 * an answer to an application question, the notes on a company, a house style
 * written once and read for months.
 *
 * Those were all rendered as a permanently open `<textarea>` holding their own
 * value. That is law 14 broken in the most literal way there is: the finished
 * thing was never shown at all, only an editor with the finished thing sitting
 * in it, and a screen of five of those is a form nobody asked to fill in.
 * Prose in a textarea is also simply harder to read -- a fixed box, a scrollbar
 * at six lines, no measure and no leading, which is why the same note reads
 * badly here and fine everywhere else.
 *
 * At rest this is the writing, set as writing. Clicking it opens the editor in
 * the same place at the same size, which is law 12: a value and its editor are
 * the same object. Empty, it is a quiet invitation rather than an empty box,
 * because a blank field that says nothing is the one state a reader cannot
 * interpret.
 *
 * `onSave` returns an error string to keep the editor open and say what went
 * wrong, or nothing to close it. Saving is deliberately explicit: these are
 * long-lived pieces of text and a blur that silently commits a half-finished
 * edit is how you lose a paragraph you were in the middle of rewriting.
 */
export function EditableProse({
  value,
  onSave,
  label,
  empty = 'Nothing written yet.',
  editLabel,
  placeholder,
  expandable = false,
  startEditing = false,
  className,
}: {
  value: string;
  onSave: (next: string) => Promise<string | null | void>;
  /** Names the field for a screen reader; there is no visible label. */
  label: string;
  /** What the read state says when there is nothing to read. */
  empty?: string;
  /** The verb on the empty state. Defaults to editing the thing by name. */
  editLabel?: string;
  placeholder?: string;
  /**
   * Open in the editor rather than at rest.
   *
   * For the one case where the read state would be a step backwards: the
   * caller is here *because* somebody just pressed a button meaning "write
   * one". Showing them an empty invitation to click again is the click they
   * already made. Only the initial state -- cancelling still returns to the
   * reading view, because from then on there is something to read.
   */
  startEditing?: boolean;
  /**
   * Offer a full-screen view. For the pieces long enough that a column inside
   * a card is the wrong shape to read or write them in.
   */
  expandable?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The saved value wins whenever it changes underneath us -- a save elsewhere
  // on the page, or a server render after a revalidate. Not while editing:
  // that would take the paragraph out from under the person writing it.
  //
  // React's documented re-seed, during render rather than in an effect: an
  // effect here would render the stale text once and then immediately render
  // again, which is the cascading render the rule against setState-in-effect
  // exists to prevent. Same shape as `useServerSeeded` in the company panels.
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    if (!editing) setDraft(value);
  }

  function begin() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  function save() {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    setError(null);
    start(async () => {
      const failed = await onSave(next);
      if (typeof failed === 'string' && failed) {
        setError(failed);
        return;
      }
      setEditing(false);
    });
  }

  const body = (
    <div className={cn('space-y-2', className)}>
      {editing ? (
        <>
          <Textarea
            autoFocus
            aria-label={label}
            value={draft}
            rows={expanded ? 16 : 5}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // The two keys anybody typing in a box already expects.
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
            className={expanded ? 'max-h-none flex-1' : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" pending={pending} onClick={save}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <FieldError>{error}</FieldError>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={begin}
          title={editLabel ?? `Edit ${label.toLowerCase()}`}
          className={cn(
            'group/prose -mx-1.5 -my-1 block w-full rounded-card px-1.5 py-1 text-left',
            'transition-colors duration-150 hover:bg-sunken',
          )}
        >
          {value.trim() ? (
            // A measure and a leading, because this is prose and the point of
            // showing it outside a textarea is that it can be read.
            <span className="block max-w-prose whitespace-pre-wrap text-ui leading-relaxed text-ink">
              {value}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-ui text-ink-ghost">
              <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              {empty}
            </span>
          )}
        </button>
      )}
    </div>
  );

  if (!expandable) return body;

  // One copy of it, in one place or the other. Rendering it in both would put
  // two textareas with the same label and the same autofocus on the page.
  if (expanded) {
    return (
      <Expanded label={label} onClose={() => setExpanded(false)}>
        {body}
      </Expanded>
    );
  }

  return (
    <div className="space-y-1">
      {body}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="press inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-small text-ink-ghost transition-colors duration-150 hover:bg-sunken hover:text-ink-muted"
        >
          <Maximize2 className="size-3" strokeWidth={1.75} aria-hidden />
          Full screen
        </button>
      </div>
    </div>
  );
}

/**
 * The full-screen view: the same component, given the room.
 *
 * Deliberately not a second copy of the editor. Whatever state the thing is in
 * -- reading, half-edited, showing an error -- is the state it is in up here,
 * because it is literally the same element moved into a larger box.
 */
function Expanded({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Escape closes it. The editor inside also answers to Escape and stops the
    // event there, so the first press leaves the editor and the second leaves
    // the full screen, which is the order anybody would expect.
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-modal flex items-stretch justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={scrim}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          popoverSurface,
          'relative flex w-full max-w-3xl flex-col gap-3 overflow-y-auto p-4 shadow-2xl outline-none sm:p-6',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-body font-semibold text-ink">{label}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
