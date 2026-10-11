'use client';

import { startTransition } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { LinkPending } from '@/components/ui/link-pending';
import { countLabel } from '@/lib/news/issues/list';
import { recordArticleOpened } from '../quick/actions';

/** One line of the review, with where it opens. */
export type ReviewLine = {
  issueId: string;
  storyIndex: number;
  href: string;
  line: string;
  /** How many newsletters ran the event. */
  sources: number;
  local?: boolean;
};

/**
 * The review's stories, one line each, in the order Dash listed them. Each
 * line opens its story's own page.
 *
 * Pressing a line records an open the way Read the article does on Quick
 * read (openStory in lib/news/issues/quick.ts): the story is passed with
 * opened_at set, so Quick read's ranking counts it as interest in that topic
 * and newsletter, and Quick read does not deal you a story you have already
 * read. Only the line pressed is recorded; reading the review passes nothing.
 * The write runs while the story page loads, and a navigation does not wait
 * for it.
 */
export function ReviewLines({ lines }: { lines: readonly ReviewLine[] }) {
  return (
    <ol className="divide-y divide-border">
      {lines.map((item, i) => (
        <li key={`${item.issueId}:${item.storyIndex}`}>
          <Link
            href={item.href}
            onClick={() => {
              startTransition(() => {
                void recordArticleOpened(item.issueId, item.storyIndex);
              });
            }}
            className="press group flex items-start gap-3 py-3 transition-colors duration-quick hover:text-accent"
          >
            <span
              aria-hidden
              className="w-5 shrink-0 pt-px text-right text-ui tabular-nums text-ink-muted"
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-body leading-snug text-ink group-hover:text-accent">
                {item.line}
              </span>
              {(item.local || item.sources > 1) && (
                <span className="mt-0.5 block text-small text-ink-muted">
                  {[item.local ? 'Local' : null, item.sources > 1 ? `In ${countLabel(item.sources)}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </span>
            <ChevronRight
              className="mt-1 size-4 shrink-0 text-ink-muted group-hover:text-accent"
              strokeWidth={1.75}
              aria-hidden
            />
            <LinkPending />
          </Link>
        </li>
      ))}
    </ol>
  );
}
