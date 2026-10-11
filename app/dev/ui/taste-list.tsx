'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError } from '@/components/ui/field';
import { removeTaste, restoreTaste, type TasteActionState } from './actions';
import { describeSources, splitTaste, type Taste } from './taste';

/**
 * The person's preferences on /dev/ui, each with a Remove (plan #1547), and
 * the ones they removed folded underneath with a way to put each back.
 * `removed` is the ids in `public.ui_taste_removals`; `openRemoved` starts
 * the fold open, for the gallery.
 */
export function TasteList({
  removed,
  openRemoved = false,
}: {
  removed: readonly string[];
  openRemoved?: boolean;
}) {
  const split = splitTaste(removed);
  return (
    <div className="space-y-3">
      {/* The same single surface and hairlines as the laws above, so the
       * two read as one list at two scales. */}
      <Card padding="none">
        {split.kept.length === 0 ? (
          <p className="card-pad-x row-pad text-body text-ink-muted">
            You have removed every preference. The critic holds screens to the laws alone.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {split.kept.map((taste) => (
              <TasteRow key={taste.id} taste={taste} />
            ))}
          </ul>
        )}
      </Card>
      {split.removed.length > 0 && (
        /* Flush, so the removed rows share the edges of the list above. */
        <Disclosure
          title="Removed"
          meta={split.removed.length}
          defaultOpen={openRemoved}
          bodyClassName="mt-2"
        >
          <Card padding="none">
            <ul className="divide-y divide-border">
              {split.removed.map((taste) => (
                <TasteRow key={taste.id} taste={taste} removed />
              ))}
            </ul>
          </Card>
        </Disclosure>
      )}
    </div>
  );
}

/**
 * One preference: the sentence on its own line at full width, then where it
 * came from with Remove (or Put back) at the end of that line, so the button
 * takes no width from the sentence on a phone.
 */
function TasteRow({ taste, removed = false }: { taste: Taste; removed?: boolean }) {
  const [state, action, pending] = useActionState(
    removed ? restoreTaste : removeTaste,
    {} as TasteActionState,
  );
  return (
    <li id={removed ? undefined : `taste-${taste.id}`} className="card-pad-x row-pad">
      <p className={removed ? 'text-body text-ink-muted' : 'text-body text-ink'}>
        {taste.sentence}
      </p>
      <div className="mt-0.5 flex items-start gap-3">
        <p className="min-w-0 flex-1 text-small text-ink-muted">
          From {describeSources(taste.sources)}.{' '}
          <a
            href={`/preview?s=${taste.example}`}
            className="whitespace-nowrap underline hover:text-accent"
          >
            See it done right
          </a>
        </p>
        <form action={action} className="-my-1 shrink-0">
          <input type="hidden" name="id" value={taste.id} />
          <Button type="submit" size="sm" variant="ghost" pending={pending}>
            {removed ? 'Put back' : 'Remove'}
          </Button>
        </form>
      </div>
      <FieldError>{state.error}</FieldError>
    </li>
  );
}
