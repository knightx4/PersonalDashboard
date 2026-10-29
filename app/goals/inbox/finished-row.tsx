'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { CloseButton } from '@/components/inbox/close-button';
import { DashMark } from '@/components/ui/dash-mark';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { closedToast } from '@/lib/core/lifecycle';
import { stepHref } from '@/lib/goals/all-goals';
import type { TodayItem } from '@/lib/goals/today';
import { dismissStepNoticeAction, restoreStepNoticeAction } from './actions';

/**
 * The notice of a step Dash finished that you asked to be told about
 * (plan #2611.2; finishedNotices in lib/goals/today.ts): the step's title,
 * which opens it, the first sentence of what Dash wrote, and the goal.
 *
 * Opening the step marks the notice seen, so the row is gone the next time
 * the Inbox draws. Done puts it away without opening it: the row leaves at
 * once and the toast's Undo brings it back. Done shows on hover from laptop
 * width and always on a phone, where nothing hovers.
 */
export function FinishedRow({
  item,
  onGone,
  revealed = false,
}: {
  item: TodayItem;
  /** Draw Done showing, as hover shows it, for the gallery. */
  revealed?: boolean;
  /** Hide the row (true) or bring it back (false). */
  onGone: (gone: boolean) => void;
}) {
  const toast = useToast();
  const form = () => {
    const data = new FormData();
    data.set('id', item.id);
    return data;
  };
  const dismiss = async () => {
    onGone(true);
    const result = await dismissStepNoticeAction(form());
    if (result.error) {
      onGone(false);
      toast({ text: result.error });
      return;
    }
    toast({
      text: closedToast('done', item.title),
      undone: 'Brought back.',
      undo: async () => {
        const back = await restoreStepNoticeAction(form());
        if (back.error) throw new Error(back.error);
        onGone(false);
      },
    });
  };

  return (
    <li className="group card-pad-x row-pad flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="inline-flex items-center gap-1.5 text-small font-semibold text-ink-muted">
          <DashMark size="2xs" tone="brand" decorative />
          Dash finished this
        </p>
        <Link
          href={stepHref(item.goalId, item.id)}
          className="press-area block text-body font-semibold break-words text-ink hover:underline"
        >
          {item.title}
        </Link>
        {item.detail && <p className="text-small break-words text-ink-muted">{item.detail}</p>}
        <p className="text-small break-words text-ink-muted">
          <Link
            href={`/goals/${item.goalId}`}
            className={cn('press-area', linkVariants({ tone: 'quiet' }))}
          >
            {item.goalTitle}
          </Link>
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 transition-opacity duration-quick',
          !revealed && 'sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100',
        )}
      >
        <CloseButton lifecycle="done" compact label={item.title} onClick={() => void dismiss()} />
      </span>
    </li>
  );
}
