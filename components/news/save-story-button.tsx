'use client';

import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { setStorySaved } from '@/app/news/i/[id]/actions';

/**
 * Save, or Saved (plan #869). One press puts the story on the Saved list and
 * the button reads Saved; pressing Saved takes it off again. #867 settled on
 * one list, so there is nothing to choose on the way.
 *
 * Shared by the issue page's stories and the Quick read card. Optimistic: the
 * words change on the press, and a write the server refuses puts them back and
 * says why in a toast, both from useOptimisticWrite. `saved` is what the page
 * was rendered with, which the action's revalidation brings back up to date.
 */
export function SaveStoryButton({
  issueId,
  headline,
  saved,
  className,
}: {
  issueId: string;
  headline: string;
  saved: boolean;
  className?: string;
}) {
  const { shown, run, failed } = useOptimisticWrite<boolean, boolean>({
    value: saved,
    apply: (_current, next) => next,
    write: (next) => setStorySaved(issueId, headline, next),
  });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={shown}
      title={shown ? 'Take this story off your Saved list' : 'Keep this story on your Saved list'}
      onClick={() => run(!shown)}
      className={cn(shown && 'text-accent', failed && 'text-danger', className)}
    >
      {shown ? (
        <BookmarkCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
      ) : (
        <Bookmark className="size-3.5" strokeWidth={1.75} aria-hidden />
      )}
      {shown ? 'Saved' : 'Save'}
    </Button>
  );
}
