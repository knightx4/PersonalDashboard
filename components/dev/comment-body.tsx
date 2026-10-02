import { Markdown } from '@/components/ui/markdown';
import type { PlanRefTitles } from '@/lib/comments/refs';

/**
 * What one comment says, laid out.
 *
 * An answer from a session is written as markdown and arrives with lists,
 * links and code in it; rendered pre-wrapped, that is one wall of text with
 * hyphens down the left of it. This is the shared renderer
 * (components/ui/markdown.tsx), held to a shorter list of elements: a comment
 * is a turn in a conversation, so there is no call for headings, no table and
 * no image, and a `#` at the start of a line is far more often a step number
 * than a heading.
 */

/** What a comment is allowed to draw. Everything else is unwrapped to its text. */
const ALLOWED = ['p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'span'];

export function CommentBody({
  body,
  titles,
  refs = true,
}: {
  body: string;
  titles?: PlanRefTitles;
  /**
   * Whether `#494` links to the plan step. Off for a reply from Dash in a
   * conversation (note 7cf4109a), where a `#3` is a list number or a count
   * far more often than a step.
   */
  refs?: boolean;
}) {
  return (
    <Markdown
      markdown={body}
      className="comment-prose"
      allowedElements={ALLOWED}
      mentions
      planRefs={refs ? { titles } : false}
    />
  );
}
