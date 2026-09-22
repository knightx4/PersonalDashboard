import {
  planRefHref,
  planRefLabel,
  planRefText,
  splitOnRefs,
  type PlanRefTitles,
} from '@/lib/comments/refs';

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
 * every newline and run of spaces the raise was written with.
 */
export function RefText({ text, titles }: { text: string; titles?: PlanRefTitles }) {
  const parts = splitOnRefs(text);
  if (!parts.some((part) => part.ref !== null)) return <>{text}</>;

  return (
    <>
      {parts.map((part, index) =>
        part.ref === null ? (
          <span key={index}>{part.text}</span>
        ) : (
          <a
            key={index}
            href={planRefHref(part.ref)}
            className="comment-ref underline underline-offset-2 hover:text-accent"
            title={planRefLabel(part.ref, titles)}
          >
            {planRefText(part.ref, titles)}
          </a>
        ),
      )}
    </>
  );
}
