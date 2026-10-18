'use client';

import { useActionState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CommentCount } from '@/components/dev/comment-count';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import type { ListRowView } from '@/lib/goals/goal-lists';
import { confirmListRowAction, type ListActionState } from './list-actions';

/**
 * The pieces every view of a goal's list draws a row with (plans #2330.3 and
 * #2330.4): the picture's tile, the name as a link, and the marks after it.
 */

/** A picture's tile. The hairline is the photo's edge, so a white product shot does not melt into the panel. */
export const THUMB = 'block size-10 shrink-0 overflow-hidden rounded-control border border-border bg-sunken'; // ui-ok: hand-rolled-box -- a photo's frame, not a grouping

export function Thumb({ src }: { src: string | null }) {
  return (
    <span className={THUMB}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary shop CDNs
        <img src={src} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

/** The row's name: a link to its own page, out to the page it was pasted from, or plain once it has gone. */
export function RowTitle({ row }: { row: ListRowView }) {
  if (row.external && row.href) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noreferrer"
        className="press-area break-words font-semibold text-ink hover:text-accent"
      >
        {row.title}
        <ExternalLink
          className="ml-1 inline size-3.5 align-[-0.125em] text-ink-muted"
          strokeWidth={1.75}
          aria-label="opens the page"
        />
      </a>
    );
  }
  if (row.href) {
    return (
      <Link
        href={row.href}
        className="press-area break-words font-semibold text-ink hover:text-accent"
      >
        {row.title}
      </Link>
    );
  }
  return (
    <span className={cn('break-words font-semibold', row.gone ? 'text-ink-muted' : 'text-ink')}>
      {row.title}
    </span>
  );
}

/** What sits after the name on any row: gone, comments, and a draft's Confirm. */
export function RowMarks({ row }: { row: ListRowView }) {
  if (!row.gone && row.comments < 1 && !row.draft) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {row.gone && <Chip size="sm">No longer there</Chip>}
      <CommentCount count={row.comments} />
      {row.draft && <DraftConfirm recordId={row.id} />}
    </span>
  );
}

/** A row a link filled in: marked Draft, with the press that confirms it as it stands. */
export function DraftConfirm({ recordId }: { recordId: string }) {
  const [state, confirm, pending] = useActionState(
    async (_prev: ListActionState, form: FormData) => confirmListRowAction(form),
    {},
  );
  return (
    <form action={confirm} className="relative z-10 inline-flex items-center gap-1.5">
      <input type="hidden" name="recordId" value={recordId} />
      <Chip tone="caution" size="sm">
        Draft
      </Chip>
      <Button type="submit" variant="secondary" size="xs" pending={pending}>
        Confirm
      </Button>
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}

