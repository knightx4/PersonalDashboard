'use client';

import { useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/cn';
import type { InboxBundle } from '@/lib/goals/inbox';
import type { TodayItem } from '@/lib/goals/today';
import { TodayRow } from '../today-list';
import { leaveQuestionsAction } from './actions';

const keyOf = (item: TodayItem) => `${item.kind}:${item.id}`;

/**
 * Several Inbox rows that say one thing, drawn as one (lib/goals/inbox.ts,
 * bundleRows): a goal's questions from Dash, or the goals offered for
 * parking. The line says what they are; Show them opens the rows themselves,
 * each with its own buttons.
 *
 * A goal's questions also carry Leave them as they are, which closes every
 * one with things staying as they were, the same close a question gets after
 * five days with no answer (migrations-goals/0088). Nothing is lost by
 * leaving them: the steps they were about go back on the goal's page.
 */
export function BundleRow({
  bundle,
  onGone,
}: {
  bundle: InboxBundle;
  /** The row has been answered as a whole: hide it (true) or bring it back (false). */
  onGone: (gone: boolean) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const items = bundle.items.filter((item) => !hidden.has(keyOf(item)));
  const hide = (key: string, gone: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (gone) next.add(key);
      else next.delete(key);
      return next;
    });

  const leave = () => {
    const form = new FormData();
    for (const item of items) form.append('id', item.id);
    setError(null);
    start(async () => {
      const result = await leaveQuestionsAction(form);
      if (result.error) setError(result.error);
      else onGone(true);
    });
  };

  return (
    <li className="card-pad-x row-pad space-y-2">
      <div className="min-w-0 space-y-1">
        {bundle.goalId ? (
          <Link
            href={`/goals/${bundle.goalId}`}
            className="press-area block text-body font-semibold break-words text-ink hover:underline"
          >
            {bundle.title}
          </Link>
        ) : (
          <p className="text-body font-semibold break-words text-ink">{bundle.title}</p>
        )}
        <p className="text-small break-words text-ink-muted">{bundle.detail}</p>
        {bundle.kind === 'questions' && (
          <p className="text-small text-ink-muted">
            Any you leave unanswered close by themselves after five days, and the step stays as it
            was.
          </p>
        )}
      </div>
      {bundle.kind === 'questions' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={leave} pending={pending}>
            Leave them as they are
          </Button>
          {bundle.goalId && (
            <Link
              href={`/goals/${bundle.goalId}`}
              className={cn('press-area text-small', linkVariants({ tone: 'quiet' }))}
            >
              Open the goal
            </Link>
          )}
          {error && <span className="w-full text-small text-danger">{error}</span>}
        </div>
      )}
      <Disclosure
        title={bundle.kind === 'questions' ? 'Answer them one by one' : 'Show them'}
        meta={String(items.length)}
        summaryClassName="py-1 max-sm:min-h-11"
        bodyClassName="mt-1"
      >
        <ul className="divide-y divide-border border-t border-border">
          {items.map((item) => (
            <TodayRow
              key={keyOf(item)}
              item={item}
              rank={null}
              preparable={false}
              onAside={(gone) => hide(keyOf(item), gone)}
              onSnoozed={(gone) => hide(keyOf(item), gone)}
            />
          ))}
        </ul>
      </Disclosure>
    </li>
  );
}
