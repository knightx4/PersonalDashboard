'use client';

import { useActionState } from 'react';
import {
  acceptVisionEdit,
  dismissVisionEdit,
  type VisionEditActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import { commentWhen } from '@/lib/comments/when';
import { FEEDBACK_KIND_LABEL, type FeedbackKind } from '@/lib/feedback/load';
import { useClockNow } from '@/lib/use-clock-now';
import type { VisionReview } from '@/lib/specs/vision-review';

/**
 * An edit the weekly vision review proposed, under the vision it would change
 * (plan #1106).
 *
 * The proposed text, the review's reason for it, and the notes and likes it
 * cites, with Accept and Dismiss. Accepting replaces the vision above with the
 * proposed text; dismissing leaves the vision as it is. Either way the edit
 * leaves the page, since the page shows only edits still waiting.
 */
export function VisionEditPanel({
  edit,
  currentBody,
  label,
}: {
  edit: VisionReview;
  /** The vision as it reads now, to say when the edit was drafted against an older one. */
  currentBody: string | null;
  /** What the workspace is called. */
  label: string;
}) {
  const [accepted, accept, accepting] = useActionState(
    acceptVisionEdit,
    {} as VisionEditActionState,
  );
  const [dismissed, dismiss, dismissing] = useActionState(
    dismissVisionEdit,
    {} as VisionEditActionState,
  );
  const now = useClockNow();
  const pending = accepting || dismissing;
  const drafted = edit.visionBody === null;
  const stale = (edit.visionBody ?? null) !== (currentBody ?? null);
  const count = edit.evidence.length;

  return (
    <section
      aria-label={`Proposed edit to the vision for ${label}`}
      className="mb-3 space-y-2 rounded-control bg-sunken px-3 py-2.5"
    >
      <p className="text-caption text-ink-muted">
        {drafted ? 'Dash drafted a vision' : 'Dash proposes an edit'},{' '}
        <time dateTime={edit.createdAt} className="tabular">
          {commentWhen(edit.createdAt, now)}
        </time>
      </p>
      <p className="whitespace-pre-wrap text-body text-ink">{edit.proposedBody}</p>
      <p className="whitespace-pre-wrap text-ui text-ink-muted">{edit.note}</p>
      {stale && (
        <p className="text-caption text-ink-muted">
          The vision has changed since this was written. Accepting replaces what it says now.
        </p>
      )}

      {count > 0 && (
        <Disclosure
          title="Evidence"
          meta={`${count} ${count === 1 ? 'note' : 'notes'}`}
        >
          <ul className="space-y-1.5">
            {edit.evidence.map((item) => (
              <li key={item.id} className="text-ui">
                <span className="text-ink">{item.body}</span>
                <span className="block text-caption text-ink-ghost">
                  {FEEDBACK_KIND_LABEL[item.kind as FeedbackKind] ?? item.kind}
                  {item.pagePath ? ` on ${item.pagePath}` : ''},{' '}
                  <time dateTime={item.createdAt} className="tabular">
                    {commentWhen(item.createdAt, now)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <form className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={edit.id} />
        <Button type="submit" size="sm" formAction={accept} disabled={pending}>
          {accepting ? 'Accepting…' : 'Accept'}
        </Button>
        <Button type="submit" size="sm" variant="ghost" formAction={dismiss} disabled={pending}>
          {dismissing ? 'Dismissing…' : 'Dismiss'}
        </Button>
        <FieldError>{accepted.error ?? dismissed.error}</FieldError>
      </form>
    </section>
  );
}
