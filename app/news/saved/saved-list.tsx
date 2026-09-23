'use client';

import Link from 'next/link';
import { Bookmark, BookmarkMinus, ExternalLink } from 'lucide-react';
import { StoryText } from '@/components/news/story-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import type { SavedStory } from '@/lib/news/saved/stories';
import { removeSaved } from './actions';

/** A saved story with its newsletter's arrival already formatted: "22 Sep, 07:14". */
export type SavedListStory = SavedStory & { arrived: string };

/**
 * The Saved tab's stories, or how to save one when there are none (plan #870).
 *
 * Remove is optimistic: the story leaves the list on the press, and a write
 * the server refuses brings it back with a toast, both from useOptimisticWrite.
 * The empty state is drawn here rather than by the page so removing the last
 * story shows it at once instead of after the refresh.
 */
export function SavedList({ stories }: { stories: SavedListStory[] }) {
  const { shown, run } = useOptimisticWrite<SavedListStory[], string>({
    value: stories,
    apply: (current, id) => current.filter((story) => story.id !== id),
    write: (id) => removeSaved(id),
  });

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="Nothing saved yet"
        description="Press Save under a story in Quick read or on a newsletter's page, and it is kept here with its picture, its full text and its link until you remove it."
        action={{ label: 'Go to Quick read', href: '/news' }}
      />
    );
  }

  return (
    <Card padding="dense">
      <ul className="divide-y divide-border">
        {shown.map((story) => (
          <li key={story.id} className="py-3 first:pt-0 last:pb-0">
            <article>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui text-ink-muted">
                    {story.issueId ? (
                      <Link href={`/news/i/${story.issueId}`} className="hover:text-ink hover:underline">
                        {story.senderName}
                      </Link>
                    ) : (
                      story.senderName
                    )}
                    {` · ${story.arrived}`}
                  </p>
                  <h2 className="mt-0.5 break-words text-body font-semibold text-ink">
                    {story.headline}
                  </h2>
                  <p className="mt-1 break-words text-body leading-relaxed text-ink-muted">
                    {story.summary}
                  </p>
                </div>
                {story.image && (
                  // A plain img for the reason given on the issue page: the
                  // address is the sender's, and next/image would need every
                  // sender's host listed.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={story.image}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-20 shrink-0 rounded-card bg-sunken object-cover sm:size-24"
                  />
                )}
              </div>
              <StoryText text={story.text ?? undefined} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                {story.link ? (
                  <a
                    href={story.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ui text-accent hover:underline"
                  >
                    Read the article
                    <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
                  </a>
                ) : (
                  <span aria-hidden />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title="Take this story off your Saved list"
                  onClick={() => run(story.id)}
                  className="-mr-2.5"
                >
                  <BookmarkMinus className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Remove
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </Card>
  );
}
