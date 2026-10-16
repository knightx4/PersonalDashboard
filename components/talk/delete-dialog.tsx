'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

/** Rows listed before "and n more". */
const SHOWN = 10;

/**
 * The "Are you sure?" popup for a delete Dash proposed (plan #2232.2). It
 * lists what would go, with Delete and Cancel, and focus starts on Cancel so
 * a stray Enter removes nothing. Escape and a press on the backdrop are
 * Cancel. While the delete runs the popup stays open and cannot be dismissed;
 * if the server refuses, the reason shows here and the rows are kept.
 *
 * A native modal dialog, so the page behind is inert and focus stays inside.
 */
export function DeleteDialog({
  count,
  titles,
  noun = ['answer', 'answers'],
  pending,
  error,
  onDelete,
  onCancel,
}: {
  count: number;
  titles: readonly string[];
  noun?: readonly [string, string];
  pending: boolean;
  error: string | null;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
  }, []);

  const label = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  const shown = titles.slice(0, SHOWN);
  const more = Math.max(count, titles.length) - shown.length;

  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !pending) onCancel();
      }}
      /* ui-ok: the popup's own edge, a floating panel that has nothing behind it to separate it from */
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-surface p-5 text-ink shadow-lg backdrop:bg-black/40"
    >
      <h2 id="delete-dialog-title" className="font-display text-title font-semibold tracking-tight text-ink">
        Delete {label}?
      </h2>
      <p className="mt-1 text-ui text-ink-muted">You can take this back with Undo on Home once it is done.</p>
      {shown.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-card bg-sunken px-3 py-2.5 text-ui text-ink">
          {shown.map((title, index) => (
            <li key={index} className="break-words">
              {title}
            </li>
          ))}
          {more > 0 && <li className="text-ink-muted">and {more} more</li>}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <FieldError>{error}</FieldError>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="danger" pending={pending} onClick={onDelete}>
          {pending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </dialog>
  );
}
