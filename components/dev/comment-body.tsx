import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitOnMention } from '@/lib/comments/mention';
import {
  planRefHref,
  planRefLabel,
  planRefText,
  splitOnRefs,
  type PlanRefTitles,
} from '@/lib/comments/refs';

/**
 * What one comment says, laid out.
 *
 * An answer from a session is written as markdown and arrives with lists,
 * links and code in it; rendered pre-wrapped, that is one wall of text with
 * hyphens down the left of it. This is the same renderer the vault note body
 * and the interview prep note use, held to a shorter list of elements: a
 * comment is a turn in a conversation, so there is no call for headings, no
 * table and no image, and a `#` at the start of a line is far more often a
 * step number than a heading.
 *
 * `rehype-raw` is absent, and its absence is the sanitizer -- the same rule
 * the vault keeps. With raw HTML off, react-markdown renders embedded markup
 * as the text it is rather than as elements.
 */

/** What a comment is allowed to draw. Everything else is unwrapped to its text. */
const ALLOWED = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'a',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'span',
];

/** The shape of the tree the plugin below walks. Only what it touches. */
type Node = {
  type: string;
  value?: string;
  children?: Node[];
  data?: Record<string, unknown>;
};

/**
 * Mark `@dash` wherever it is written, so it reads as addressing somebody.
 *
 * A remark plugin rather than a pass over the rendered text, because the tag
 * has to be found in the words and left alone inside code: a comment quoting
 * `@dash` in a fenced block is showing the tag, not using it. Text nodes are
 * the only ones carrying words, so walking those does both.
 *
 * The marked run is a node of its own with `hName` set, which is how a tree
 * says "draw this as a span" without raw HTML being involved anywhere.
 */
function markMentions() {
  return (tree: Node) => walk(tree);
}

function walk(node: Node): void {
  if (!node.children) return;

  const out: Node[] = [];
  for (const child of node.children) {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      walk(child);
      out.push(child);
      continue;
    }

    const parts = splitOnMention(child.value);
    if (!parts.some((part) => part.mention)) {
      out.push(child);
      continue;
    }

    for (const part of parts) {
      if (part.text === '') continue;
      out.push(
        part.mention
          ? {
              type: 'mention',
              children: [{ type: 'text', value: part.text }],
              data: { hName: 'span', hProperties: { className: ['comment-mention'] } },
            }
          : { type: 'text', value: part.text },
      );
    }
  }
  node.children = out;
}

/**
 * Turn `#494` into the step it names.
 *
 * The same shape as the mention plugin above and for the same reason -- the
 * numbers have to be found in the words and left alone inside code, and text
 * nodes are the only ones carrying words, so walking those does both. A
 * `inlineCode` or `code` node holds its value directly rather than in a text
 * child, so it is never descended into and a quoted `#494` stays quoted.
 *
 * `link` is skipped as well, which the mention walk does not have to care
 * about: a span inside an anchor is fine and an anchor inside one is not. A
 * reference already written as a link is a reference that has been linked.
 * `mention` is skipped because a marked run is exactly the tag and cannot
 * contain a number.
 */
const OPAQUE = new Set(['link', 'linkReference', 'definition', 'mention']);

function markPlanRefs(titles?: PlanRefTitles) {
  return () => (tree: Node) => walkRefs(tree, titles);
}

function walkRefs(node: Node, titles?: PlanRefTitles): void {
  if (!node.children || OPAQUE.has(node.type)) return;

  const out: Node[] = [];
  for (const child of node.children) {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      walkRefs(child, titles);
      out.push(child);
      continue;
    }

    const parts = splitOnRefs(child.value);
    if (!parts.some((part) => part.ref !== null)) {
      out.push(child);
      continue;
    }

    for (const part of parts) {
      if (part.text === '') continue;
      out.push(
        part.ref !== null
          ? {
              type: 'planRef',
              children: [{ type: 'text', value: planRefText(part.ref, titles) }],
              data: {
                hName: 'a',
                hProperties: {
                  href: planRefHref(part.ref),
                  className: ['comment-ref'],
                  title: planRefLabel(part.ref, titles),
                },
              },
            }
          : { type: 'text', value: part.text },
      );
    }
  }
  node.children = out;
}

export function CommentBody({ body, titles }: { body: string; titles?: PlanRefTitles }) {
  return (
    <div className="comment-prose">
      <Markdown
        remarkPlugins={[remarkGfm, markMentions, markPlanRefs(titles)]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a({ href, children, ...props }) {
            const external = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
