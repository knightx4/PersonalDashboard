'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { DIRECTION_ANSWERS, type DirectionOffer as Offer } from '@/lib/learn/prepare/branch';
import { chooseDirection, dismissDirection, type DirectionPressState } from './actions';

/**
 * The offer to go deeper (plan #2276.7), on the subject's page once the
 * person has answered DIRECTION_ANSWERS graded questions on its lens.
 *
 * Two to four branches of the territory, each with what it leads to and one
 * press. Picking one raises the targets under it and starts a run for that
 * branch alone, whose steps then show on the page; Not now puts the offer
 * away. Either way it comes back after another DIRECTION_ANSWERS answers.
 */

/** A branch run is a pull, a match, one layout call and ten to twenty drafts. */
export const BRANCH_COST = 'About $1 to $2';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function DirectionOffer({ subjectId, offer, live = true }: {
  subjectId: string;
  offer: Offer;
  /** False in the gallery, whose presses go nowhere. */
  live?: boolean;
}) {
  const router = useRouter();
  const [picked, pick, picking] = useActionState<DirectionPressState, FormData>(chooseDirection, {});
  const [dismissed, dismiss, dismissing] = useActionState<DirectionPressState, FormData>(dismissDirection, {});
  const [pressed, setPressed] = useState<string | null>(null);
  const error = picked.error ?? dismissed.error ?? null;

  useEffect(() => {
    if (picked.done || dismissed.done) router.refresh();
  }, [picked.done, dismissed.done, router]);

  const busy = picking || dismissing;
  return (
    <Card padding="standard" className="mb-6">
      <h2 className="text-body font-semibold text-ink">Where do you want to go deeper?</h2>
      <p className="mt-1 text-ui text-ink-muted">
        You have answered {plural(offer.answers, 'question')} here. Pick a branch and Dash drafts the
        topics beneath it, and raises your targets on the ones already there.
      </p>
      <form action={live ? pick : undefined} className="mt-2">
        <input type="hidden" name="subjectId" value={subjectId} />
        <ul className="divide-y divide-border">
          {offer.branches.map((branch) => (
            // The name takes the whole row; the press sits right of the tally under it.
            <li key={branch.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-3">
              <p className="col-span-2 text-body font-semibold text-ink">{branch.name}</p>
              <p className="mt-1 text-small text-ink-muted">
                {plural(branch.topics, 'topic')} · leads to {branch.leadsTo.join(', ')}
              </p>
              <DashAction
                type="submit"
                name="branch"
                value={branch.key}
                variant="secondary"
                size="sm"
                disabled={busy}
                pending={picking && pressed === branch.key}
                onClick={() => setPressed(branch.key)}
                costText={BRANCH_COST}
                what={`Cost of going deeper on ${branch.name}`}
              >
                {picking && pressed === branch.key ? 'Starting…' : 'Go deeper'}
              </DashAction>
            </li>
          ))}
        </ul>
      </form>
      <form action={live ? dismiss : undefined} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <input type="hidden" name="subjectId" value={subjectId} />
        <Button type="submit" variant="link" size="sm" disabled={busy} className="-my-2 py-2">
          {dismissing ? 'Putting it away…' : 'Not now'}
        </Button>
        <span className="text-small text-ink-muted">Asked again after another {DIRECTION_ANSWERS} answers.</span>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-small text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
