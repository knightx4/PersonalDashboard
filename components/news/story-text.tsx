import { ChevronRight } from 'lucide-react';
import { storyParagraphs } from '@/lib/news/issues/stories';

/**
 * The story as the email told it, folded under its summary. A details element,
 * so opening it needs no script and no second request.
 *
 * Shared by the issue page's story list and the Quick read card. Draws nothing
 * for a story with no text of its own, which is every story summarised before
 * the text was kept.
 */
export function StoryText({ text }: { text: string | undefined }) {
  const paragraphs = storyParagraphs(text);
  if (paragraphs.length === 0) return null;
  return (
    <details className="group mt-1.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ui text-accent hover:underline [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3 transition-transform group-open:rotate-90"
          strokeWidth={2}
          aria-hidden
        />
        <span className="group-open:hidden">Read the full story</span>
        <span className="hidden group-open:inline">Hide the full story</span>
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="break-words text-body leading-relaxed text-ink">
            {paragraph}
          </p>
        ))}
      </div>
    </details>
  );
}
