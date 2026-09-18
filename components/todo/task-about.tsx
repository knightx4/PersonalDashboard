'use client';

import { useRef, useState, useTransition } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { usePopover } from '@/lib/use-popover';
import { useToast } from '@/components/ui/toast';
import { LinkFinder } from '@/components/todo/link-picker';
import { pointTaskAt, unpointTask } from '@/app/todo/actions';

/**
 * Saying what a task is about, from the row it is already on.
 *
 * A task is usually written before anyone knows what it belongs to, so the
 * anchor has to be addable later -- and the place to add it is the row, not a
 * page the task does not have.
 *
 * Two controls, both in the row's own action group: one opens the same finder
 * the add form uses, and one takes the anchor off again. The second only
 * appears when there is one, because a control that does nothing is a control
 * that lies.
 *
 * On a narrow row there is no room for either. Passing `open` puts the finder
 * under the row's overflow menu instead: the component draws no buttons of its
 * own and is only the panel, because the two it would otherwise add are the
 * third and fourth icon in a row that is allowed three. Unlinking moves into
 * that menu with them, so nothing is lost by taking the buttons away.
 *
 * The chip itself is drawn by the row, from the anchor the page resolved. This
 * writes and lets the page come back with the answer.
 */
export function TaskAbout({
  taskId,
  linked,
  open: openProp,
  onOpenChange,
}: {
  taskId: string;
  linked: boolean;
  /** Set to drive the finder from somewhere else; the buttons go away with it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controlled = openProp !== undefined;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ? openProp : ownOpen;

  function setOpen(next: boolean) {
    if (controlled) onOpenChange?.(next);
    else setOwnOpen(next);
  }

  const [pending, start] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  return (
    <span className="relative inline-flex items-center gap-0.5">
      {!controlled && (
        <button
          ref={triggerRef}
          type="button"
          title={linked ? 'Point it at something else' : 'What is this about?'}
          aria-expanded={open}
          disabled={pending}
          onClick={() => setOpen(!open)}
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-50"
        >
          <Link2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">
            {linked ? 'Point it at something else' : 'What is this about?'}
          </span>
        </button>
      )}

      {!controlled && linked && (
        <button
          type="button"
          title="Not about anything"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const { error } = await unpointTask(taskId);
              toast({ text: error ?? 'unlinked' });
            })
          }
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-50"
        >
          <Link2Off className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Not about anything</span>
        </button>
      )}

      {open && (
        <LinkFinder
          ref={panelRef}
          align="right"
          onPick={(choice) => {
            setOpen(false);
            start(async () => {
              // The trigger in the database is what refuses a target that is
              // not yours, and its words are what gets said. Nothing is
              // guessed at here.
              const { error } = await pointTaskAt(taskId, choice.target, choice.targetId);
              toast({ text: error ?? `about ${choice.label}` });
            });
          }}
        />
      )}
    </span>
  );
}
