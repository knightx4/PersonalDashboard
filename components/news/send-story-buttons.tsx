'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, BookOpenCheck, ListChecks, ListPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import {
  makeTodoFromStory,
  sendStoryToLearn,
  type SendStoryInput,
} from '@/app/news/i/[id]/actions';

/**
 * Send to Learn and Make a todo (plan #1370), drawn beside Save on every story
 * in News: the story page, the newsletter, Quick read and the Saved tab.
 *
 * One press sends the story and the button turns into a link to where it
 * went: "On your reading queue" opens the reading, "Todo made" opens the task.
 * Optimistic, the way SaveStoryButton is: the words change on the press, and a
 * write the server refuses puts them back with a toast. Until the write comes
 * back with the reading or the task there is nothing to link to, so the sent
 * words show as a plain button for that moment.
 *
 * `readingId` and `taskId` are what the page was rendered with
 * (lib/news/saved/sent.ts), so a reload keeps the sent state.
 */
export function SendStoryButtons({
  story,
  readingId = null,
  taskId = null,
  className,
}: {
  story: SendStoryInput;
  readingId?: string | null;
  taskId?: string | null;
  className?: string;
}) {
  return (
    <>
      <SendButton
        sentId={readingId}
        send={async () => {
          const result = await sendStoryToLearn(story);
          return result.error === null ? { id: result.readingId } : { error: result.error };
        }}
        label="Send to Learn"
        sentLabel="On your reading queue"
        title="Put this story on your Learn reading queue"
        href={(id) => `/learn/r/${id}`}
        icon={BookOpen}
        sentIcon={BookOpenCheck}
        className={className}
      />
      <SendButton
        sentId={taskId}
        send={async () => {
          const result = await makeTodoFromStory(story);
          return result.error === null ? { id: result.taskId } : { error: result.error };
        }}
        label="Make a todo"
        sentLabel="Todo made"
        title="Make a todo that opens this story"
        href={(id) => `/todo/all?status=all&focus=${id}`}
        icon={ListPlus}
        sentIcon={ListChecks}
        className={className}
      />
    </>
  );
}

function SendButton({
  sentId,
  send,
  label,
  sentLabel,
  title,
  href,
  icon: Icon,
  sentIcon: SentIcon,
  className,
}: {
  sentId: string | null;
  send: () => Promise<{ id: string } | { error: string }>;
  label: string;
  sentLabel: string;
  title: string;
  href: (id: string) => string;
  icon: LucideIcon;
  sentIcon: LucideIcon;
  className?: string;
}) {
  // What the write came back with, for a page the action does not re-render
  // (Quick read keeps the card it drew); the rendered id otherwise.
  const [made, setMade] = useState<string | null>(null);
  const id = made ?? sentId;
  const { shown, run, failed } = useOptimisticWrite<boolean, true>({
    value: id !== null,
    apply: () => true,
    write: async () => {
      const result = await send();
      if ('error' in result) return result;
      setMade(result.id);
      return { error: null };
    },
  });

  if (shown && id) {
    return (
      <Link
        href={href(id)}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-accent', className)}
      >
        <SentIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
        {sentLabel}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={title}
      disabled={shown}
      onClick={() => run(true)}
      className={cn(shown && 'text-accent', failed && 'text-danger', className)}
    >
      {shown ? (
        <SentIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
      ) : (
        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      )}
      {shown ? sentLabel : label}
    </Button>
  );
}
