'use client';

import Link from '@/components/ui/link';
import { useActionState, useTransition } from 'react';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { CloseButton } from '@/components/inbox/close-button';
import { closedToast, type Lifecycle } from '@/lib/core/lifecycle';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { contextTitle, type ContextItem } from '@/lib/goals/context';
import { setContextStatusAction, type ContextActionState } from './context-actions';
import { LinkedText } from '@/components/ui/linked-text';

const initial: ContextActionState = {};

/**
 * What the other modules hold that bears on this goal (docs/GOALS-SPEC.md,
 * "Pulling in from the other modules"): a vault note on what you want, your
 * job search thoughts, a Learn aim. Claude finds them when it maps the goal;
 * each row says where it lives, why it matters here and the words that do,
 * and opens in its own module. What Dash proposed waits for Keep or Decline;
 * one kept can be dropped from its menu later. Either way it is not proposed
 * again, and the toast's Undo puts it back as it was (plan #1957.8).
 */
export function GoalContext({ items }: { items: ContextItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="context-heading" className="space-y-2">
      <h2 id="context-heading" className="px-1 text-ui font-semibold text-ink">
        From your other modules
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <ContextRow key={item.id} item={item} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function ContextRow({ item }: { item: ContextItem }) {
  const toast = useToast();
  const [state, settle, settling] = useActionState(setContextStatusAction, initial);
  const [dismissing, startDismiss] = useTransition();
  const title = contextTitle(item.title);
  const proposed = item.status === 'proposed';

  // Decline on what Dash proposed, Drop on one already kept.
  async function dismiss(lifecycle: Lifecycle) {
    const form = new FormData();
    form.set('id', item.id);
    form.set('status', 'dismissed');
    const result = await setContextStatusAction(initial, form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    const was = item.status;
    toast({
      text: closedToast(lifecycle, title),
      undo: async () => {
        const back = new FormData();
        back.set('id', item.id);
        back.set('status', was);
        const undone = await setContextStatusAction(initial, back);
        if (undone.error) throw new Error(undone.error);
      },
    });
  }

  return (
    <li className="card-pad-x row-pad flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-ui break-words text-ink">
          <span className="text-small text-ink-muted">{item.module} · </span>
          {item.href ? (
            <Link href={item.href} className="hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <p className="text-small text-ink-muted">{item.why}</p>
        {item.excerpt && (
          <blockquote className="border-l-2 border-border pl-2 text-small break-words whitespace-pre-wrap text-ink">
            <LinkedText text={item.excerpt} />
          </blockquote>
        )}
        {proposed && (
          <form action={settle} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" name="status" value="kept" size="sm" variant="secondary" pending={settling}>
              Keep
            </Button>
            <CloseButton
              lifecycle="declined"
              disabled={settling}
              pending={dismissing}
              onClick={() => startDismiss(() => dismiss('declined'))}
            />
            {state.error && <span className="text-small text-danger">{state.error}</span>}
          </form>
        )}
      </div>
      {!proposed && (
        <ActionMenu
          label={`${title} actions`}
          items={[
            {
              id: 'dismiss',
              label: 'Drop',
              lifecycle: 'dropped',
              onSelect: () => void dismiss('dropped'),
            },
          ]}
        />
      )}
    </li>
  );
}
