'use client';

import { useActionState, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { savePostWants, type PostsActionState } from './actions';

/**
 * What I want from posts (plan #2227.2): a line under the heading, beside Ask
 * for a post and Write your own, holding what the person wants Dash's drafts
 * to be like. The posts run reads it before it drafts.
 *
 * With nothing saved it is a one-line prompt that opens the box. With text
 * saved it is that text on one line and the day it was saved; a click opens
 * the box to change it. Emptying the box and saving clears it, and the runs
 * draft as they did before.
 *
 * `defaultOpen`, `pendingPreview` and `errorPreview` are for the surface
 * gallery, which draws the box open, mid-save and refused.
 */
export function PostWantsLine({
  text,
  day,
  max,
  defaultOpen = false,
  pendingPreview = false,
  errorPreview,
}: {
  text: string;
  /** The day it was last saved, as 2 Oct; null when nothing is saved. */
  day: string | null;
  max: number;
  defaultOpen?: boolean;
  pendingPreview?: boolean;
  errorPreview?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState(
    async (prev: PostsActionState, formData: FormData) => {
      const next = await savePostWants(prev, formData);
      if (!next.error) setOpen(false);
      return next;
    },
    {} as PostsActionState,
  );
  const saving = pending || pendingPreview;
  const error = state.error ?? errorPreview;

  if (!open) {
    if (!text) return <AddTrigger label="Say what you want from posts" onClick={() => setOpen(true)} />;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`What you want from posts: ${text}. Change it`}
        className={cn(
          // The same strip the box opens into, so the saved words read as
          // something written that a press opens, not as page description.
          // ui-ok: the compose strip's own frame, matching the box it opens into; the critic asked for it
          'press flex w-full min-w-0 items-baseline gap-2 rounded-control border border-control bg-surface',
          'px-(--control-px) py-1.5 text-left text-ui transition-colors duration-quick hover:border-accent',
        )}
      >
        <span className="shrink-0 text-ink-muted">You want</span>
        <span className="min-w-0 flex-1 truncate text-ink">{text}</span>
        {day && <span className="shrink-0 text-small text-ink-muted">Saved {day}</span>}
      </button>
    );
  }

  return (
    <form action={action} className="space-y-1">
      <ComposeBox>
        <ComposeBody
          name="wants"
          autoFocus={!defaultOpen}
          defaultValue={text}
          maxLength={max}
          rows={3}
          className="min-h-11"
          aria-label="What you want from posts"
          placeholder="What you want from posts: who they are for, the tone, what to leave out"
        />
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <span className="mr-auto basis-full text-small text-ink-muted sm:basis-auto">
            {text ? 'Empty it and save to go back to no preference.' : 'Dash reads this before it drafts.'}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </ComposeBox>
      {saving && (
        <p role="status" className="text-small text-ink-muted">
          Saving what you want from posts…
        </p>
      )}
      {error && !saving && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
