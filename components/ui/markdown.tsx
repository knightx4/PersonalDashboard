import type { ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { splitOnMention } from '@/lib/comments/mention';
import {
  planRefHref,
  planRefLabel,
  planRefText,
  splitOnRefs,
  type PlanRefTitles,
} from '@/lib/comments/refs';
import { linkBareDomains } from '@/lib/goals/result-links';

/**
 * Markdown, rendered the one way the app renders it (plan #1431).
 *
 * Notes, files, prep notes, specs, comments and Dash's replies all come
 * through here, so a heading, a list or a link looks and behaves the same on
 * every page. What differs between them is an option, not a second setup:
 *
 * - `fold` makes every heading a native <details> owning what sits under it.
 * - `mentions` marks `@dash` where it is written.
 * - `planRefs` links `#494` to the step on the plan.
 * - `allowedElements` narrows what may be drawn (a comment has no headings).
 * - `resolveHref` rewrites a link, or returns null to keep the text unlinked.
 * - `image` draws an image; without it an image is its alt text.
 * - `remarkPlugins` and `rehypePlugins` add to the pipeline, which is how the
 *   vault brings maths without the rest of the app shipping KaTeX.
 *
 * Bare domains (`respark.com`) are written as links before rendering
 * (note 28d33a48), since markdown on its own only links a full address. An
 * off-site link opens in a new tab.
 *
 * `rehype-raw` is absent everywhere, and its absence is the sanitizer: with
 * raw HTML off, react-markdown renders embedded markup as the text it is.
 * An off-site image is shown as a label because rendering it would report
 * every read to whoever hosts it.
 *
 * No hooks, so it renders on the server and inside client components alike.
 */

export type MarkdownProps = {
  markdown: string;
  className?: string;
  /** Every heading folds what sits beneath it, down to the next peer. */
  fold?: boolean;
  /** Mark `@dash` as addressing somebody. */
  mentions?: boolean;
  /** Link `#494` to the plan step; pass titles to label it the way the plan does. */
  planRefs?: boolean | { titles?: PlanRefTitles };
  /** What may be drawn; anything else is unwrapped to its text. */
  allowedElements?: readonly string[];
  /** Rewrite a link's target, or return null to show its text unlinked. */
  resolveHref?: (href: string | undefined) => string | null | undefined;
  /** Draw an image; the default shows its alt text. */
  image?: (props: { src: string; alt: string }) => ReactNode;
  /** Write bare domains as links first. On unless the caller has a reason. */
  bareDomains?: boolean;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
};

type PluggableList = NonNullable<Options['remarkPlugins']>;

/* ------------------------------------------------------------------ plugins */

/** The shape of the tree the plugins below walk. Only what they touch. */
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
 * the only ones carrying words, so walking those does both. The marked run is
 * a node with `hName` set, which draws a span without raw HTML.
 */
function markMentions() {
  return (tree: Node) => walkMentions(tree);
}

function walkMentions(node: Node): void {
  if (!node.children) return;

  const out: Node[] = [];
  for (const child of node.children) {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      walkMentions(child);
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
 * The same shape as the mention plugin and for the same reason. Code holds its
 * value directly rather than in a text child, so a quoted `#494` stays quoted.
 * `link` is skipped because an anchor inside an anchor is not allowed, and a
 * reference already written as a link has been linked. `mention` is skipped
 * because a marked run is exactly the tag and cannot contain a number.
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

/* ----------------------------------------------------------------- sections */

export type Section = {
  level: number;
  title: string;
  body: string;
  children: Section[];
};

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/**
 * Splits markdown into the text before its first heading and a tree of
 * sections. A heading owns everything down to the next heading of the same or
 * a higher level, so `###` sections fold inside their `##`.
 */
export function splitSections(source: string): { preamble: string; sections: Section[] } {
  const root: Section = { level: 0, title: '', body: '', children: [] };
  const stack: Section[] = [root];
  const lines: Map<Section, string[]> = new Map([[root, []]]);
  let fence: string | null = null;

  for (const line of source.split('\n')) {
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
    }

    const heading = fence === null ? line.match(HEADING) : null;
    if (heading) {
      const level = heading[1].length;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const section: Section = { level, title: heading[2], body: '', children: [] };
      stack[stack.length - 1].children.push(section);
      stack.push(section);
      lines.set(section, []);
      continue;
    }

    lines.get(stack[stack.length - 1])!.push(line);
  }

  for (const [section, body] of lines) section.body = body.join('\n').trim();
  return { preamble: root.body, sections: root.children };
}

/* ----------------------------------------------------------------- renderer */

type Pipeline = {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
  components: Components;
  allowedElements?: readonly string[];
};

function pipeline(props: MarkdownProps): Pipeline {
  const { mentions, planRefs, resolveHref, image, allowedElements } = props;
  const titles = typeof planRefs === 'object' ? planRefs.titles : undefined;

  return {
    remarkPlugins: [
      remarkGfm,
      ...(props.remarkPlugins ?? []),
      ...(mentions ? [markMentions] : []),
      ...(planRefs ? [markPlanRefs(titles)] : []),
    ],
    rehypePlugins: props.rehypePlugins ?? [],
    allowedElements,
    components: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `node` is the hast element, not an attribute
      a({ href, children, node, ...rest }) {
        const resolved = resolveHref ? resolveHref(href) : href;
        // A link with nowhere to go keeps its words and loses the click.
        if (resolved === null) return <span className="text-ink-muted">{children}</span>;
        const external = /^https?:\/\//i.test(resolved ?? '');
        return (
          <a
            href={resolved}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            {...rest}
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        if (image) return <>{image({ src: typeof src === 'string' ? src : '', alt: alt ?? '' })}</>;
        return <em className="text-ink-muted">{alt ? `(image: ${alt})` : '(image)'}</em>;
      },
    },
  };
}

function Body({ source, setup }: { source: string; setup: Pipeline }) {
  if (!source) return null;
  return (
    <ReactMarkdown
      remarkPlugins={setup.remarkPlugins}
      rehypePlugins={setup.rehypePlugins}
      components={setup.components}
      allowedElements={setup.allowedElements}
      unwrapDisallowed={setup.allowedElements !== undefined}
    >
      {source}
    </ReactMarkdown>
  );
}

const INLINE = ['strong', 'em', 'code', 'del', 'a', 'span'];

/** A heading's own text, inline: emphasis, code and links survive, blocks do not. */
function Title({ source, setup }: { source: string; setup: Pipeline }) {
  return <Body source={source} setup={{ ...setup, allowedElements: INLINE }} />;
}

function Fold({ section, setup }: { section: Section; setup: Pipeline }) {
  return (
    <details className="group/fold fold-section" data-level={section.level}>
      <summary
        className={cn(
          'press -mx-1 flex cursor-pointer list-none items-center gap-1.5 rounded-control px-1 py-0.5',
          'hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={2}
          className="size-3.5 shrink-0 text-ink-muted transition-transform duration-150 group-open/fold:rotate-90"
        />
        <span role="heading" aria-level={Math.min(section.level + 2, 6)} className="fold-title">
          <Title source={section.title} setup={setup} />
        </span>
      </summary>
      <div className="fold-body">
        <Body source={section.body} setup={setup} />
        {section.children.map((child, index) => (
          <Fold key={`${child.title}-${index}`} section={child} setup={setup} />
        ))}
      </div>
    </details>
  );
}

export function Markdown(props: MarkdownProps) {
  const { markdown, className, fold = false, bareDomains = true } = props;
  const setup = pipeline(props);
  const source = bareDomains ? linkBareDomains(markdown) : markdown;

  if (!fold) {
    return (
      <div className={className}>
        <Body source={source} setup={setup} />
      </div>
    );
  }

  // Native <details> so a note folds before JavaScript loads (law 6). A note
  // with no headings draws no folds at all.
  const { preamble, sections } = splitSections(source);
  return (
    <div className={className}>
      <Body source={preamble} setup={setup} />
      {sections.map((section, index) => (
        <Fold key={`${section.title}-${index}`} section={section} setup={setup} />
      ))}
    </div>
  );
}
