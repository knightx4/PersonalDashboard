import {
  planRefHref,
  planRefLabel,
  planRefText,
  refTarget,
  splitOnRefs,
  type PlanRefTitles,
} from '@/lib/comments/refs';
import { planKey } from '@/lib/core/ref-preview';
import { LinkedText } from '@/components/ui/linked-text';
import { RefLink } from '@/components/ui/ref-link';
import { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';

/**
 * Plain text, with its step numbers turned into links.
 *
 * `CommentBody` next door does this inside a markdown pipeline, which is right
 * for a comment: a session writes those with lists and code in them. A raise is
 * not that. Its ask, its consequence and its story are written as prose and
 * drawn `whitespace-pre-wrap`, and putting them through markdown to reach the
 * linker would change how every existing raise is rendered -- a line beginning
 * with a dash becoming a list, an underscore in a file path becoming emphasis
 * -- to buy one thing that does not need markdown at all.
 *
 * So this is the same reading over the same splitter, with nothing else
 * changed: the text is still the text, and the numbers in it are now links.
 * The caller keeps its own `whitespace-pre-wrap`, and the fragments preserve
 * every newline and run of spaces the raise was written with. Addresses in
 * the text are links too, through LinkedText, so a raise that names a page
 * opens it.
 */
export function RefText({ text, titles }: { text: string; titles?: PlanRefTitles }) {
  const parts = splitOnRefs(text, titles);
  if (!parts.some((part) => refTarget(part) !== null)) return <LinkedText text={text} refs={false} />;

  return (
    <>
      {parts.map((part, index) => {
        const target = refTarget(part);
        if (target === null) {
          return (
            <span key={index}>
              {/* The splitter has read every step reference already; an
                  outline it left as words names no step on the plan. */}
              <LinkedText text={part.text} refs={false} />
            </span>
          );
        }
        // Each previews its step on hover or hold (plan #1931.4).
        return (
          <RefLink
            key={index}
            href={planRefHref(target)}
            previewKey={planKey(target)}
            className={cn('comment-ref', linkVariants())}
            title={part.ref === null ? undefined : planRefLabel(part.ref, titles)}
          >
            {part.ref === null ? part.text : planRefText(part.ref, titles)}
          </RefLink>
        );
      })}
    </>
  );
}
