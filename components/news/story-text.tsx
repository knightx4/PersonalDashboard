import Link, { linkVariants } from '@/components/ui/link';
import { ChevronRight } from 'lucide-react';
import { Disclosure } from '@/components/ui/disclosure';
import { storyAddsToSummary, storyParagraphs } from '@/lib/news/issues/stories';

/**
 * The story as the email told it, folded under its summary. A details element,
 * so opening it needs no script and no second request.
 *
 * Shared by the issue page's story list and the Quick read card. Draws nothing
 * for a story with no text of its own, which is every story summarised before
 * the text was kept, and for one whose text is the summary shown above it
 * word for word (note 86b9c6d1).
 *
 * Given `href`, the story's own page, it is a link there instead of a fold
 * (note a18729e3): the Quick read opens the story rather than growing the card.
 */
export function StoryText({
  text,
  summary,
  href,
}: {
  text: string | undefined;
  summary?: string;
  href?: string;
}) {
  const paragraphs = storyParagraphs(text);
  if (paragraphs.length === 0 || !storyAddsToSummary(text, summary)) return null;
  if (href) {
    return (
      <Link
        href={href}
        className={`mt-1.5 inline-flex items-center gap-1 text-ui ${linkVariants()}`}
      >
        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        Read the full story
      </Link>
    );
  }
  return (
    <Disclosure
      className="mt-1.5"
      title={
        <>
          <span className="group-open/disc:hidden">Read the full story</span>
          <span className="hidden group-open/disc:inline">Hide the full story</span>
        </>
      }
      bodyClassName="mt-2 space-y-2 border-l-2 border-border pl-3"
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="break-words text-body leading-relaxed text-ink">
          {paragraph}
        </p>
      ))}
    </Disclosure>
  );
}
