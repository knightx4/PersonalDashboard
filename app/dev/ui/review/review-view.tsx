'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { DEV_STATE_WORD, findingState } from '@/lib/dev/words';
import { UI_FINDING_GLYPHS } from '@/lib/status-glyphs';
import { StateLabel } from '@/components/dev/state-label';
import type { UiFinding, UiReview } from '@/lib/ui-review/load';
import { UI_SCOPES, type UiScope } from '@/lib/ui-review/scope';
import { decideUiFinding, startUiReview, type UiReviewActionState } from './actions';

/** One module's standing: the gate, the surfaces, and the last pass. */
export type Standing = {
  scope: UiScope;
  label: string;
  /** Violations the gate has recorded against this module's files. */
  violations: number;
  /** Surfaces in the preview gallery, which is what there is to look at. */
  surfaces: number;
  /** Null means nobody has ever reviewed it, which is not the same as clean. */
  lastReview: UiReview | null;
};

/** The gate's count, as a sentence rather than a number on its own. */
function gateLine(violations: number): string {
  if (violations === 0) return 'Nothing the gate can see';
  return `${violations} mechanical violation${violations === 1 ? '' : 's'}`;
}

function reviewLine(review: UiReview | null): string {
  if (!review) return 'Never reviewed';
  const open = review.findings.filter((finding) => finding.status === 'open').length;
  const date = review.createdAt.slice(0, 10);
  if (open === 0) return `Reviewed ${date}`;
  return `Reviewed ${date} · ${open} to decide`;
}

/** Start a pass on one module. */
function StartReview({ scope }: { scope: UiScope }) {
  const [state, action, pending] = useActionState(startUiReview, {} as UiReviewActionState);

  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="module" value={scope} />
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        <Play className="size-3.5" aria-hidden />
        Review it
      </Button>
      {/* Said out loud, both ways. A pass that could not start looks exactly
          like one that started and found nothing. */}
      {state.message && <p className="text-small text-ink-muted">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function StandingRow({ standing }: { standing: Standing }) {
  const { scope, label, violations, surfaces, lastReview } = standing;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-body font-semibold text-ink">{label}</span>
        <span className="text-small text-ink-muted">{gateLine(violations)}</span>
        {surfaces > 0 ? (
          <Link
            href={`/dev/surfaces#surfaces-${scope}`}
            className="text-small text-accent hover:underline"
          >
            {surfaces} surface{surfaces === 1 ? '' : 's'}
          </Link>
        ) : (
          /* Law 2: a module with nothing in the gallery cannot be looked at,
             and saying nothing here would read as a module with nothing to
             look at because it is small. */
          <span className="text-small text-ink-muted">Nothing to look at yet</span>
        )}
        <span className="text-small text-ink-muted">{reviewLine(lastReview)}</span>
      </div>

      {lastReview?.note && (
        <p className="whitespace-pre-wrap text-body text-ink">{lastReview.note}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StartReview scope={scope} />
        <Link
          href={{ pathname: '/dev/ui/review', query: { module: scope } }}
          className="text-small text-accent hover:underline"
        >
          Just this one
        </Link>
      </div>
    </li>
  );
}

/** One thing a pass found, with the two answers it is waiting for. */
function FindingRow({ finding }: { finding: UiFinding }) {
  const [state, action, pending] = useActionState(decideUiFinding, {} as UiReviewActionState);

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular text-small text-ink-muted">
          {finding.file}
          {finding.line !== null && `:${finding.line}`}
        </span>
        {finding.law && <span className="text-small text-ink-muted">law {finding.law}</span>}
        {finding.surface && (
          <Link
            href={`/preview?s=${finding.surface}`}
            className="text-small text-accent hover:underline"
          >
            {finding.surface}
          </Link>
        )}
        {/* "Confirmed" is this queue's own -- a pass proposed it and you agreed
            it is real. A finding you turned down is the same fact as a step
            dropped or a note declined, so it takes the shared word. */}
        {finding.status !== 'open' && (
          <StateLabel
            glyph={UI_FINDING_GLYPHS[finding.status]}
            word={
              finding.status === 'confirmed'
                ? 'Confirmed'
                : DEV_STATE_WORD[findingState(finding.status) ?? 'dropped']
            }
            tone={finding.status === 'confirmed' ? 'info' : 'ghost'}
          />
        )}
      </div>

      <p className="whitespace-pre-wrap text-body text-ink">{finding.body}</p>
      {finding.note && <p className="text-small text-ink-muted">{finding.note}</p>}

      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={finding.id} />
        {finding.status === 'open' ? (
          <>
            <Button type="submit" name="decision" value="confirmed" size="sm" pending={pending}>
              Confirm
            </Button>
            <Button
              type="submit"
              name="decision"
              value="dismissed"
              size="sm"
              variant="ghost"
              disabled={pending}
            >
              Dismiss
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            name="decision"
            value="open"
            size="sm"
            variant="ghost"
            pending={pending}
          >
            Put it back
          </Button>
        )}
        <FieldError>{state.error}</FieldError>
      </form>
    </li>
  );
}

/**
 * The standings, and what the passes found.
 *
 * Findings are their own section rather than rows nested under each module:
 * the list at the top is read to decide what to look at next, and a page that
 * unrolled every finding inside it would be a page you scroll past to reach
 * the module you came for. Only findings still waiting on you are shown --
 * confirmed and dismissed ones are kept for the next pass, not for re-reading.
 */
export function ReviewView({
  standings,
  only,
}: {
  standings: Standing[];
  only: UiScope | null;
}) {
  const undecided = standings.flatMap((standing) =>
    (standing.lastReview?.findings ?? [])
      .filter((finding) => finding.status === 'open')
      .map((finding) => ({ finding, scope: standing.scope })),
  );

  return (
    <div className="space-y-6">
      <nav aria-label="Module" className="flex flex-wrap items-center gap-1">
        <Link
          href="/dev/ui/review"
          aria-current={only === null ? 'page' : undefined}
          className={cn(
            'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-150',
            only === null
              ? 'bg-accent text-surface'
              : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
          )}
        >
          Everything
        </Link>
        {UI_SCOPES.map((scope) => (
          <Link
            key={scope}
            href={{ pathname: '/dev/ui/review', query: { module: scope } }}
            aria-current={only === scope ? 'page' : undefined}
            className={cn(
              'press rounded-full px-2.5 py-1 text-small font-medium capitalize transition-colors duration-150',
              only === scope
                ? 'bg-accent text-surface'
                : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
            )}
          >
            {scope}
          </Link>
        ))}
      </nav>

      <ul className={cn(cardVariants(), 'divide-y divide-border')}>
        {standings.map((standing) => (
          <StandingRow key={standing.scope} standing={standing} />
        ))}
      </ul>

      {/* No section at all when there is nothing waiting: an empty box under a
          heading saying "0 findings" is law 1 twice over. */}
      {undecided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink">
            To decide <span className="font-normal text-ink-muted">({undecided.length})</span>
          </h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {undecided.map(({ finding }) => (
              <FindingRow key={finding.id} finding={finding} />
            ))}
          </ul>
        </section>
      )}

      <p className="text-small text-ink-muted">
        The laws these are held against are on{' '}
        <Link href="/dev/ui" className="text-accent hover:underline">
          the UI page
        </Link>
        .
      </p>
    </div>
  );
}
