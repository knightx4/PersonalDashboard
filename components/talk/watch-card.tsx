'use client';

import { useState, useTransition } from 'react';
import { Check, CircleSlash, Clock, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CloseButton } from '@/components/inbox/close-button';
import { closedToast } from '@/lib/core/lifecycle';
import type { ChangeOutcome } from '@/lib/ask/changes';
import type { DashChange } from '@/lib/talk/changes';
import {
  WATCH_STATUS_WORDS,
  matchedWords,
  watchRhythm,
  type WatchCard,
  type WatchDecision,
  type WatchStatus,
} from '@/lib/you/watch-card-model';

/**
 * A watch Dash wrote for someone on People, as its card in the thread (plan
 * #3030.1.2): what it checks and where it stands first, then how often, what
 * sends a text and the tables it reads, then a sample text, with Approve and
 * Decline while it waits. Approve sets the watch active and Decline sets it
 * declined; the toast after Decline puts it back.
 *
 * The press is handed in (app/chat/actions.ts, or the gallery's fixtures),
 * keyed by the set_reach_out change that proposed the watch.
 */

const GLYPH: Record<WatchStatus, typeof Check> = {
  proposed: Clock,
  active: Check,
  declined: CircleSlash,
  paused: Pause,
  stopped: CircleSlash,
};

export function WatchProposal({
  change,
  watch: given,
  press,
  onChanged,
}: {
  change: DashChange;
  watch: WatchCard;
  press?: (id: string, decision: WatchDecision) => Promise<ChangeOutcome>;
  onChanged?: (change: DashChange) => void;
}) {
  const [watch, setWatch] = useState(given);
  const [seen, setSeen] = useState(given);
  // A newer copy from the thread (a reply re-read the changes) wins.
  if (given !== seen) {
    setSeen(given);
    setWatch(given);
  }
  const [pressing, setPressing] = useState<WatchDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startPress] = useTransition();
  const toast = useToast();

  function decide(decision: WatchDecision) {
    if (!press) return;
    setError(null);
    setPressing(decision);
    startPress(async () => {
      const outcome = await press(change.id, decision).catch(
        (): ChangeOutcome => ({ ok: false, error: 'That did not go through. Check your connection and try again.', change: null }),
      );
      setPressing(null);
      if (outcome.change?.watch) {
        setWatch(outcome.change.watch);
        onChanged?.(outcome.change);
      }
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      if (decision === 'decline') {
        toast({
          text: closedToast('declined', watch.about),
          undo: async () => {
            const back = await press(change.id, 'reopen');
            if (!back.ok) throw new Error(back.error);
            if (back.change.watch) setWatch(back.change.watch);
            onChanged?.(back.change);
          },
        });
      }
    });
  }

  const proposed = watch.status === 'proposed';
  const state = WATCH_STATUS_WORDS[watch.status];
  const Glyph = GLYPH[watch.status];
  const matched = matchedWords(watch.matched);

  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className={proposed || watch.status === 'active' ? 'text-ui font-medium text-ink' : 'text-ui font-medium text-ink-muted'}>
          {watch.about}
        </p>
        <p className="flex flex-wrap items-center gap-x-1 text-small text-ink-muted">
          <Glyph className={watch.status === 'active' ? 'size-3.5 text-positive' : 'size-3.5'} strokeWidth={1.75} aria-hidden />
          <span className={watch.status === 'active' ? 'font-medium text-ink' : 'font-medium'}>{state.label}</span>
          {!proposed && <span>{state.note}</span>}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
        <dt className="text-ink-muted">How often</dt>
        <dd className="text-ink">{watchRhythm(watch)}</dd>
        <dt className="text-ink-muted">Texts when</dt>
        <dd className="text-ink">{watch.sendsWhen}</dd>
        <dt className="text-ink-muted">Reads</dt>
        <dd className="break-words text-ink">
          {watch.tables.join(', ')}
          {matched && <span className="text-ink-muted"> · {matched}</span>}
        </dd>
      </dl>

      <figure className="space-y-0.5">
        <figcaption className="text-small text-ink-muted">A text would read</figcaption>
        <blockquote className="border-l-2 border-border-strong pl-2.5 text-ui text-ink">{watch.sample}</blockquote>
      </figure>

      {proposed && press && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" pending={pressing === 'approve'} disabled={pressing !== null} onClick={() => decide('approve')}>
              {pressing === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
            <CloseButton
              lifecycle="declined"
              variant="secondary"
              pending={pressing === 'decline'}
              disabled={pressing !== null}
              onClick={() => decide('decline')}
            />
          </div>
          <p className="text-small text-ink-muted">Once you approve it, Undo can no longer take it back.</p>
        </div>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
