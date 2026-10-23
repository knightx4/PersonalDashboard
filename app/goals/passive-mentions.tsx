'use client';

import { useState, useTransition } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { PRESS_AREA } from '@/components/ui/button';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/toast';
import { closedToast } from '@/lib/core/lifecycle';
import { formatWeekday } from '@/lib/goals/dates';
import type { PassiveMention } from '@/lib/goals/passive-mentions';
import { dismissMentionAction, undismissMentionAction } from './mention-actions';

/**
 * What is coming up within a week under a passive goal (plan #2503.5): one
 * plain line each, with the goal it sits under and Decline, the quietest
 * press there is. Nothing here goes to Do next or Todo. Decline hides the
 * line at once and keeps it out of the morning note; the toast's Undo brings
 * it back. Not drawn when there is nothing coming up.
 */
export function PassiveMentions({ mentions }: { mentions: readonly PassiveMention[] }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = mentions.filter((m) => !hidden.has(m.ref));
  if (shown.length === 0) return null;
  const hide = (ref: string, on: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  return (
    <section aria-labelledby="mentions-heading" className="space-y-1">
      <h2 id="mentions-heading" className="px-1 text-small text-ink-muted">
        Coming up, optional
      </h2>
      <ul className="space-y-2">
        {shown.map((m) => (
          <MentionLine key={m.ref} mention={m} onHide={(on) => hide(m.ref, on)} />
        ))}
      </ul>
    </section>
  );
}

function MentionLine({ mention, onHide }: { mention: PassiveMention; onHide: (on: boolean) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const external = /^https?:\/\//.test(mention.href);

  function decline() {
    onHide(true);
    start(async () => {
      const result = await dismissMentionAction(mention.ref, mention.on);
      if (result.error) {
        onHide(false);
        toast({ text: result.error });
        return;
      }
      toast({
        text: closedToast('declined', mention.title),
        undo: async () => {
          const back = await undismissMentionAction(mention.ref);
          if (back.error) throw new Error(back.error);
          onHide(false);
        },
      });
    });
  }

  return (
    <li className="flex items-center gap-2 px-1">
      {/* The whole two lines are the link, so its press area is not clipped by the ellipsis. */}
      <Link
        href={mention.href}
        title={mention.title}
        className={cn(PRESS_AREA, 'block min-w-0 flex-1')}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        <span className={cn(linkVariants({ tone: 'quiet' }), 'block truncate text-small text-ink')}>
          {mention.title}
        </span>
        <span className="block truncate text-small text-ink-muted">
          {formatWeekday(mention.on)} · {mention.goalTitle}
        </span>
      </Link>
      <CloseButton lifecycle="declined" size="xs" disabled={pending} onClick={decline} />
    </li>
  );
}
