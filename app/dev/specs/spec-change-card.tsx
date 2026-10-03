'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { approveSpecChange, declineSpecChange, type SpecChangeActionState } from './actions';
import { CommentThread } from '@/components/dev/comment-thread';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { DashCredit } from '@/components/ui/dash-mark';
import { LinkedText } from '@/components/ui/linked-text';
import { commentWhen } from '@/lib/comments/when';
import { useClockNow } from '@/lib/use-clock-now';
import { countChangedLines, diffLines, type DiffLine, type SpecChange } from '@/lib/specs/changes';
import { cn } from '@/lib/cn';

/** Where a link to one change lands, on /dev/specs. */
export function specChangeAnchor(id: string): string {
  return `spec-change-${id}`;
}

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  add: 'bg-positive-tint text-ink',
  remove: 'bg-danger-tint text-ink',
  context: 'text-ink-muted',
  hunk: 'text-small text-ink-ghost',
};

const MARK: Record<DiffLine['kind'], string> = { add: '+', remove: '−', context: '', hunk: '' };
const SPOKEN: Record<DiffLine['kind'], string> = {
  add: 'Added: ',
  remove: 'Removed: ',
  context: '',
  hunk: '',
};

/**
 * The diff as added and removed lines of prose.
 *
 * Every line wraps, including a long table row or a URL, so a change is read
 * on a phone top to bottom and never sideways: the 60-line cap on the table is
 * there for that reading, and a box that scrolls sideways would undo it. Not
 * monospaced, because the specs are prose and wrap better as prose.
 */
function DiffView({ diff }: { diff: string }) {
  const lines = diffLines(diff);
  return (
    <div className="overflow-hidden rounded-control bg-sunken py-1 text-ui">
      {lines.map((line, i) => (
        <p key={i} className={cn('flex min-w-0 gap-2 px-2 py-0.5', LINE_CLASS[line.kind])}>
          <span aria-hidden className="w-3 shrink-0 select-none text-ink-muted">
            {MARK[line.kind]}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {SPOKEN[line.kind] && <span className="sr-only">{SPOKEN[line.kind]}</span>}
            {line.kind === 'hunk' ? line.text || '…' : <LinkedText text={line.text || ' '} />}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * One change to a spec, with its why and its diff, and Approve and Decline
 * while it is still proposed (plan #1506).
 *
 * Drawn as a list row: on /dev/specs under "Changes to specs", and on Home
 * under To approve, so it can be settled wherever it is read. Home folds the
 * diff, since it sits among a dozen other rows there; Specs shows it open.
 *
 * An approved change stays on Specs, without the buttons, until #1509's run
 * has written it into the spec and marked it applied.
 *
 * The thread under it (plan #1507) is where you ask Dash about the change or
 * tell it to reword it; a reword writes a new diff onto this same change.
 */
export function SpecChangeCard({
  change,
  specTitle,
  foldDiff = false,
}: {
  change: SpecChange;
  /** The spec's title from the registry, or null for a spec the change creates. */
  specTitle: string | null;
  foldDiff?: boolean;
}) {
  const toast = useToast();
  // The row leaves the list once decided, so what the press said goes in a
  // toast, which outlives it.
  const [approved, approve, approving] = useActionState(
    async (prev: SpecChangeActionState, formData: FormData) => {
      const next = await approveSpecChange(prev, formData);
      if (next.message) toast({ text: next.message });
      return next;
    },
    {} as SpecChangeActionState,
  );
  const [declined, decline, declining] = useActionState(
    async (prev: SpecChangeActionState, formData: FormData) => {
      const next = await declineSpecChange(prev, formData);
      if (next.message) toast({ text: next.message });
      return next;
    },
    {} as SpecChangeActionState,
  );
  const now = useClockNow();
  const pending = approving || declining;
  const proposed = change.status === 'proposed';
  const changed = countChangedLines(change.diff);
  const lines = `${changed} ${changed === 1 ? 'line' : 'lines'} changed`;

  return (
    <li id={specChangeAnchor(change.id)} className="scroll-mt-bar min-w-0 space-y-2 p-3">
      <div className="space-y-0.5">
        <p className="text-body font-semibold text-ink">{change.title}</p>
        <p className="text-small text-ink-muted">
          {change.madeBy === 'claude' && <DashCredit />}
          {change.madeBy === 'claude' ? 'Dash proposes a change to ' : 'Your change to '}
          {specTitle ? (
            <Link href={`/dev/specs/${change.spec}`} className="text-ink hover:underline">
              {specTitle}
            </Link>
          ) : (
            <>a new spec, {change.spec}</>
          )}
          ,{' '}
          <time dateTime={change.createdAt} className="tabular">
            {commentWhen(change.createdAt, now)}
          </time>
        </p>
      </div>

      <p className="whitespace-pre-wrap text-ui text-ink [overflow-wrap:anywhere]">
        <LinkedText text={change.why} />
      </p>

      {foldDiff ? (
        <Disclosure title="The change" meta={lines}>
          <DiffView diff={change.diff} />
        </Disclosure>
      ) : (
        <>
          <p className="text-small text-ink-muted">{lines}</p>
          <DiffView diff={change.diff} />
        </>
      )}

      {proposed ? (
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={change.id} />
          <Button type="submit" size="sm" formAction={approve} disabled={pending}>
            {approving ? 'Approving…' : 'Approve'}
          </Button>
          <Button type="submit" size="sm" variant="ghost" formAction={decline} disabled={pending}>
            {declining ? 'Declining…' : 'Decline'}
          </Button>
          <FieldError>{approved.error ?? declined.error}</FieldError>
        </form>
      ) : (
        <p className="text-small text-ink-muted">Approved. Waiting to be written into the spec.</p>
      )}

      <CommentThread
        target="change"
        id={change.id}
        thread={change.thread}
        placeholder="A note on this change, a question for Dash, or @dash reword it."
      />
    </li>
  );
}
