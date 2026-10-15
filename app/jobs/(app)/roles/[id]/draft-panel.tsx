'use client';

import { Button } from '@/components/ui/button';
import { LinkedText } from '@/components/ui/linked-text';
import { Note } from '@/components/ui/note';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/money';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import { describeOverrun, measure, overLimit, type AnswerLimit } from '@/lib/jobs/drafting/limits';

/**
 * How long a text is against its limit, "142 of 150 words", in the danger
 * colour once it runs over (plan #2130.4). Counted the way the limit is set,
 * words or characters, so it agrees with the form's own counter.
 */
export function LimitCount({
  text,
  limit,
  className,
}: {
  text: string;
  limit: AnswerLimit;
  className?: string;
}) {
  const count = measure(text, limit.unit);
  const over = count > limit.count;
  return (
    <span className={cn('tabular-nums', over ? 'text-danger' : undefined, className)}>
      {text.trim()
        ? `${formatNumber(count)} of ${formatNumber(limit.count)} ${limit.unit}`
        : `Up to ${formatNumber(limit.count)} ${limit.unit}`}
    </span>
  );
}

/**
 * Dash's draft, beside what it is a draft of and never inside it (plan
 * #2130.4). It reaches the record only through Insert, and Discard throws it
 * away: the compose.ts rule, the model may prepare text but nothing goes out
 * over your name that you did not put there.
 *
 * Shared by the answer cards and the cover letter (plan #2135.2): give it the
 * draft, the limit when there is one, and what Insert and Discard do.
 */
export function DraftPanel({
  draft,
  limit = null,
  onInsert,
  onDiscard,
  pending = false,
  className,
}: {
  draft: AnswerDraft;
  /** The limit the text is held to; null when it has none. */
  limit?: AnswerLimit | null;
  onInsert: () => void;
  onDiscard: () => void;
  /** An insert is saving: both buttons wait. */
  pending?: boolean;
  className?: string;
}) {
  // Counted here rather than trusted from the run, so a limit set since the
  // draft was written is still checked; the run's own flag covers a draft
  // whose limit this screen does not know.
  const overrun = limit ? overLimit(draft.text, limit) : (draft.overLimit ?? null);
  const cited = draft.evidenceItemIds.length;

  return (
    // A well, not a frame. This is the one thing on the page that is not
    // yours yet, and a recessed ground says that without adding a second
    // border inside the card. Law 11: a shared ground groups.
    <Note className={cn('p-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-small font-medium text-ink">A draft</h4>
        <span className="text-small text-ink-muted">Nothing is saved until you insert it and save.</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-ui leading-relaxed text-ink">
        <LinkedText text={draft.text} />
      </p>

      <p className="mt-2 text-small text-ink-muted">
        {cited === 0
          ? 'Draws on nothing from your bank.'
          : `Draws on ${cited === 1 ? 'one item' : `${cited} items`} from your bank.`}
        {limit && (
          <>
            {' · '}
            <LimitCount text={draft.text} limit={limit} />
          </>
        )}
      </p>

      {overrun && (
        <p className="mt-1 text-small text-danger">
          {limit
            ? `${formatNumber(overrun.count - overrun.limit)} ${overrun.unit} over.`
            : `${describeOverrun(overrun)}.`}{' '}
          Cut it before it goes out.
        </p>
      )}

      {draft.unsupportedClaims.length > 0 && (
        <Note tone="caution" className="mt-2" title="Not grounded in anything you wrote:">
          <ul className="list-disc pl-4 text-small text-ink">
            {draft.unsupportedClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
          <p className="mt-1 text-small text-ink-muted">Check each of these before it goes out, or cut it.</p>
        </Note>
      )}

      {draft.bannedFound.length > 0 && (
        <p className="mt-2 text-small text-caution">
          Uses {draft.bannedFound.map((phrase) => `“${phrase}”`).join(', ')}, which{' '}
          {draft.bannedFound.length === 1 ? 'is' : 'are'} on your banned list.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onInsert}>
          Insert
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </Note>
  );
}

/** For a count in a sentence: "4 answers", "one answer". */
export function countOf(n: number, one: string, many: string): string {
  return n === 1 ? `one ${one}` : `${formatNumber(n)} ${many}`;
}
