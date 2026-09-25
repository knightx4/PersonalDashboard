'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { contextTitle, type ContextItem } from '@/lib/goals/context';
import { setContextStatusAction, type ContextActionState } from './context-actions';

const initial: ContextActionState = {};

/**
 * What the other modules hold that bears on this goal (docs/GOALS-SPEC.md,
 * "Pulling in from the other modules"): a vault note on what you want, your
 * job search thoughts, a Learn aim. Claude finds them when it maps the goal;
 * each row says where it lives, why it matters here and the words that do,
 * and opens in its own module. What Claude proposed waits for Keep or Not
 * relevant; what you dismiss is not proposed again.
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
  const dismiss = async (form: FormData) => {
    const result = await setContextStatusAction(initial, form);
    if (result.error) toast({ text: result.error });
  };
  const title = contextTitle(item.title);
  const proposed = item.status === 'proposed';

  return (
    <li className="card-pad-x row-pad flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-ui break-words text-ink">
          <span className="text-small text-ink-muted">{item.module} · </span>
          {item.href ? (
            <Link href={item.href} className="underline-offset-2 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <p className="text-small text-ink-muted">{item.why}</p>
        {item.excerpt && (
          <blockquote className="border-l-2 border-border pl-2 text-small break-words whitespace-pre-wrap text-ink">
            {item.excerpt}
          </blockquote>
        )}
        {proposed && (
          <form action={settle} className="flex flex-wrap items-center gap-2 pt-1">
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" name="status" value="kept" size="sm" variant="secondary" pending={settling}>
              Keep
            </Button>
            <Button type="submit" name="status" value="dismissed" size="sm" variant="ghost" disabled={settling}>
              Not relevant
            </Button>
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
              label: 'Not relevant to this goal',
              formAction: dismiss,
              formFields: { id: item.id, status: 'dismissed' },
            },
          ]}
        />
      )}
    </li>
  );
}
