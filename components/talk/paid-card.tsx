'use client';

import { useState } from 'react';
import { Check, CircleDollarSign, CircleSlash, LoaderCircle, X } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { CloseButton } from '@/components/inbox/close-button';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { changeHref } from '@/lib/ask/change-view';
import type { ChangeOutcome } from '@/lib/ask/changes';
import { paidLineState, paidTotals, paidCostWords, type PaidLineState } from '@/lib/dash/paid-card';
import type { DashChange } from '@/lib/talk/changes';
import type { ChangePresses } from './dash-changes';

/** A queued paid press, as the card draws it. */
export type PaidChange = Extract<DashChange, { kind: 'paid_action' }>;

const OFFLINE = 'That did not go through. Check your connection and try again.';

/**
 * Everything Dash queued that costs money, from one turn, as one card (plan
 * #2228.2, feature #2228): a line per press with its estimated cost, the
 * total, and one Accept all. Accept all runs the lines in order through the
 * same confirm a single change uses, so the server claims each row before it
 * runs (lib/ask/changes.ts, confirmPaid) and a second press runs nothing
 * again. A line that fails says why and the rest still run. Decline marks
 * every line declined and runs nothing.
 *
 * Nothing on it can be undone once run, and the card says so before the
 * press. The free changes from the same answer keep their own rows and their
 * Undo (./dash-changes.tsx).
 */
export function PaidCard({
  changes: given,
  presses,
  onChanged,
}: {
  changes: readonly PaidChange[];
  presses: ChangePresses;
  onChanged?: (change: DashChange) => void;
}) {
  const [changes, setChanges] = useState<readonly PaidChange[]>(given);
  // A newer copy from the owner (a reopened thread, the other surface) wins.
  const [seen, setSeen] = useState(given);
  if (given !== seen) {
    setSeen(given);
    setChanges(given);
  }
  /** Lines this card has sent and not heard back about yet. */
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  /** Why a press on a line was refused, when the server did not keep the reason. */
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [pressing, setPressing] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which of the lines an Accept all is on, while it runs: 1 of 3. */
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);

  if (changes.length === 0) return null;

  const lines = changes.map((change) => ({
    change,
    state: paidLineState(change, { running: running.has(change.id), error: errors[change.id] }),
  }));
  const open = lines.filter((line) => line.state.state === 'waiting' || line.state.state === 'failed');
  const declined = lines.every((line) => line.state.state === 'declined');
  const totals = paidTotals(changes);
  const anyRan = totals.ran > 0;

  function heard(next: DashChange | null) {
    if (!next || next.kind !== 'paid_action') return;
    setChanges((current) => current.map((c) => (c.id === next.id ? next : c)));
    onChanged?.(next);
  }

  function acceptAll() {
    const ids = open.map((line) => line.change.id);
    setError(null);
    setPressing('accept');
    // Not in a transition: each line's spinner has to show as its press
    // starts, and a transition would hold every update until the last one.
    void (async () => {
      // In order, one at a time: each line shows its spinner as it starts.
      for (const [index, id] of ids.entries()) {
        setProgress({ at: index + 1, of: ids.length });
        setRunning((current) => new Set(current).add(id));
        const outcome = await presses.confirm(id).catch((): ChangeOutcome => ({ ok: false, error: OFFLINE, change: null }));
        heard(outcome.change);
        setErrors((current) => {
          const rest = { ...current };
          if (outcome.ok) delete rest[id];
          else rest[id] = outcome.error;
          return rest;
        });
        setRunning((current) => {
          const rest = new Set(current);
          rest.delete(id);
          return rest;
        });
      }
      setProgress(null);
      setPressing(null);
    })();
  }

  function declineAll() {
    const ids = open.map((line) => line.change.id);
    setError(null);
    setPressing('decline');
    void (async () => {
      const outcomes = await Promise.all(
        ids.map((id) => presses.decline(id).catch((): ChangeOutcome => ({ ok: false, error: OFFLINE, change: null }))),
      );
      for (const outcome of outcomes) heard(outcome.change);
      const refused = outcomes.find((outcome) => !outcome.ok);
      if (refused && !refused.ok) setError(refused.error);
      setPressing(null);
    })();
  }

  return (
    <section
      aria-label="What Dash will run, which costs money"
      className={cn('mt-2 rounded-card bg-sunken px-3 pt-1 pb-3', declined && 'text-ink-muted')}
    >
      <ul className="divide-y divide-border">
        {lines.map(({ change, state }) => (
          <li key={change.id} className="py-2.5">
            <PaidLine change={change} state={state} />
          </li>
        ))}
      </ul>

      {/* Once anything has run, what was spent and what is left, so the figure
          above Run the rest is what that press costs. */}
      <div className="space-y-1 border-t border-border pt-2.5">
        {anyRan ? (
          <>
            <TotalRow label="Spent" value={paidCostWords(totals.spent)} strong />
            {totals.open > 0 && <TotalRow label="Left to run" value={paidCostWords(totals.left)} />}
          </>
        ) : (
          <TotalRow
            label={changes.length === 1 ? 'Total' : `Total for ${changes.length}`}
            value={paidCostWords(totals.all)}
            strong={!declined}
          />
        )}
      </div>

      {anyRan && open.length === 0 && (
        <p className="mt-2 text-small text-ink-muted">None of this can be undone: the money is spent.</p>
      )}

      {open.length > 0 && !declined && (
        <div className="mt-2.5 space-y-2">
          <p className="text-small text-ink-muted" aria-live="polite">
            {progress
              ? `Running ${progress.at} of ${progress.of}. The money for each line is spent as it runs.`
              : anyRan || open.some((line) => line.state.state === 'failed')
                ? 'Run the rest runs what is left. Once run, it cannot be undone: the money is spent.'
                : 'Nothing runs until you accept. Once run, none of this can be undone: the money is spent.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              pending={pressing === 'accept'}
              disabled={pressing !== null}
              onClick={acceptAll}
            >
              <CircleDollarSign className="size-3.5" strokeWidth={1.75} aria-hidden />
              {pressing === 'accept' ? 'Running…' : anyRan || open.length < lines.length ? 'Run the rest' : 'Accept all'}
            </Button>
            <CloseButton
              lifecycle="declined"
              variant="secondary"
              pending={pressing === 'decline'}
              disabled={pressing !== null}
              onClick={declineAll}
            />
          </div>
        </div>
      )}

      {declined && (
        <p className="mt-2.5 inline-flex items-center gap-1 text-small text-ink-muted">
          <CircleSlash className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="font-medium">Declined.</span>
          <span>Nothing was run, and nothing was spent.</span>
        </p>
      )}

      <FieldError>{error}</FieldError>
    </section>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-ui">
      <span className={strong ? 'font-medium text-ink' : 'text-ink-muted'}>{label}</span>
      <span className={cn('tabular', strong ? 'font-medium text-ink' : 'text-ink-muted')}>{value}</span>
    </p>
  );
}

function LineGlyph({ state }: { state: PaidLineState }) {
  const base = 'size-3.5 shrink-0 translate-y-0.5';
  switch (state.state) {
    case 'running':
      return <LoaderCircle aria-hidden strokeWidth={1.75} className={cn(base, 'text-ink-muted motion-safe:animate-spin')} />;
    case 'done':
      // Ink, not green: on a card about money, green would read as money coming back.
      return <Check aria-hidden strokeWidth={1.75} className={cn(base, 'text-ink')} />;
    case 'failed':
      return <X aria-hidden strokeWidth={1.75} className={cn(base, 'text-danger')} />;
    case 'declined':
      return <CircleSlash aria-hidden strokeWidth={1.75} className={base} />;
    case 'waiting':
      return <CircleDollarSign aria-hidden strokeWidth={1.75} className={cn(base, 'text-ink-ghost')} />;
  }
}

const VERB: Record<PaidLineState['state'], string> = {
  waiting: 'Will run:',
  running: 'Running:',
  done: 'Ran:',
  failed: 'Did not run:',
  declined: 'Declined:',
};

/** One press: what it does, what it should cost, and what became of it. */
function PaidLine({ change, state }: { change: PaidChange; state: PaidLineState }) {
  const settled = state.state === 'declined';
  return (
    <div className="space-y-1" aria-busy={state.state === 'running' || undefined}>
      {/* The cost goes under the line on a phone, so the words keep the width. */}
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <p className={cn('flex min-w-0 items-start gap-1.5 text-ui', settled ? 'text-ink-muted' : 'text-ink')}>
          <LineGlyph state={state} />
          <span className="min-w-0">
            <span className={settled ? '' : 'text-ink-muted'}>{VERB[state.state]}</span>{' '}
            {state.state === 'done' ? (
              <Link href={changeHref(change)} className={`${linkVariants({ tone: 'inline' })} font-medium`}>
                {change.input.line}
              </Link>
            ) : (
              <span className="font-medium">{change.input.line}</span>
            )}
          </span>
        </p>
        <span className="tabular shrink-0 pl-5 text-small text-ink-muted sm:pt-px sm:pl-0">
          {paidCostWords(change.input.estimate)}
        </span>
      </div>
      {state.state === 'failed' && <p className="pl-5 text-small text-danger">{state.error}</p>}
      {state.state === 'done' && change.summary && <p className="pl-5 text-small text-ink-muted">{change.summary}</p>}
    </div>
  );
}
