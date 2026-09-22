'use client';

import { useActionState, useState } from 'react';
import { Pencil } from 'lucide-react';
import { saveModuleVision, type VisionActionState } from './actions';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Textarea } from '@/components/ui/field';
import { commentWhen } from '@/lib/comments/when';
import { useClockNow } from '@/lib/use-clock-now';
import type { ModuleVision } from '@/lib/specs/vision';
import type { ModuleId } from '@/lib/modules';

/**
 * A workspace's vision, at the head of its group on the specs page.
 *
 * The documents underneath say how the workspace works and are the
 * repository's. This one says what it is for, it is the person's, and it is
 * written here -- the layer above every spec beneath it, which is what the ask
 * was: the thing a session reads first to know what it is building towards.
 *
 * Read as prose and edited in place. A workspace with nothing written for it
 * shows a trigger and not an empty box (law 14), so a page of seven workspaces
 * is seven lines rather than seven forms. Saving an empty box takes the vision
 * back, which is the only way to remove one and needs no second control.
 */
export function ModuleVisionPanel({
  module,
  label,
  vision,
}: {
  module: ModuleId;
  /** What the workspace is called, for the trigger and the box's hint. */
  label: string;
  /** What is written now, or nothing. */
  vision: ModuleVision | null;
}) {
  const [state, action, pending] = useActionState(saveModuleVision, {} as VisionActionState);
  const [editing, setEditing] = useState(false);
  const now = useClockNow();

  // The box shuts on a save that came back clean. Adjusted during render
  // rather than in an effect, the same way the ideas composer does it.
  const [seen, setSeen] = useState<string | undefined>(undefined);
  if (state.message !== seen) {
    setSeen(state.message);
    if (state.message && !state.error) setEditing(false);
  }

  if (editing) {
    return (
      <form action={action} className="space-y-2 pb-2">
        <input type="hidden" name="module" value={module} />
        {/* ui-ok: composer-always-open -- this branch renders only once the
          * trigger or Edit has been pressed. The guard is an early return on
          * `editing`, which the gate reads only in its `if (!open)` shape. */}
        <Textarea
          name="body"
          rows={4}
          autoFocus
          defaultValue={vision?.body ?? ''}
          placeholder={`What ${label} is for, and what would make it worth having. A session reads this before the specs under it.`}
        />
        <FieldHint>
          The highest layer over this workspace. Everything below it is a
          document in the repository; this one is yours. Saving an empty box
          takes it back.
        </FieldHint>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save the vision'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <FieldError>{state.error}</FieldError>
        </div>
      </form>
    );
  }

  if (!vision) {
    return (
      <div className="pb-2">
        <AddTrigger label={`Write the vision for ${label}`} onClick={() => setEditing(true)} />
        <FieldError>{state.error}</FieldError>
      </div>
    );
  }

  return (
    <div className="space-y-1 pb-2">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap text-body text-ink">{vision.body}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={`Edit the vision for ${label}`}
          className="press flex size-6 shrink-0 items-center justify-center rounded-lg text-ink-ghost transition-colors duration-150 hover:bg-sunken hover:text-ink"
        >
          <Pencil className="size-3.5" strokeWidth={2} aria-hidden />
          <span className="sr-only">Edit the vision for {label}</span>
        </button>
      </div>
      {/* When it was last thought about. A vision nobody has touched in a year
          is the one worth re-reading, and nothing else on the row says so. */}
      <p className="text-caption text-ink-ghost">
        Written{' '}
        <time dateTime={vision.updatedAt} className="tabular">
          {commentWhen(vision.updatedAt, now)}
        </time>
      </p>
      <FieldError>{state.error}</FieldError>
    </div>
  );
}
