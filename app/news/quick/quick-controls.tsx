'use client';

import { startTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { passQuickStory, recordArticleOpened } from './actions';

/**
 * The id of the form Next submits. A swipe on the card (#855) can submit the
 * same form with `requestSubmit()`, so both go through one action and one
 * pending state.
 */
export const QUICK_NEXT_FORM = 'quick-read-next';

/**
 * The one button #847 settled on. It records the story whether or not you
 * read it, and the page comes back with the next card.
 */
export function QuickNextForm({ issueId, storyIndex }: { issueId: string; storyIndex: number }) {
  return (
    <form id={QUICK_NEXT_FORM} action={passQuickStory}>
      <input type="hidden" name="issueId" value={issueId} />
      <input type="hidden" name="storyIndex" value={storyIndex} />
      <NextButton />
    </form>
  );
}

function NextButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" pending={pending}>
      {pending ? 'Loading…' : 'Next story'}
      {!pending && <ArrowRight className="size-4" strokeWidth={2} aria-hidden />}
    </Button>
  );
}

/**
 * The article, in a new tab. Opening it records the story as passed while the
 * tab opens, and the card stays so you can come back and press Next.
 */
export function ArticleLink({
  href,
  issueId,
  storyIndex,
}: {
  href: string;
  issueId: string;
  storyIndex: number;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        startTransition(() => {
          void recordArticleOpened(issueId, storyIndex);
        });
      }}
      className="inline-flex items-center gap-1 text-ui text-accent hover:underline"
    >
      Read the article
      <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
    </a>
  );
}
