import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * A note written in markdown, where every heading folds what sits under it.
 *
 * Long notes on a round or a company are read a section at a time: the prep
 * for tomorrow, the history of the business, the questions to ask. Rendered
 * flat they are a wall; with each heading a native <details>, the closed note
 * reads as its own outline and opens where you need it. Native so that it
 * folds before JavaScript loads (law 6).
 *
 * A heading owns everything down to the next heading of the same or a higher
 * level, so `###` sections fold inside their `##`. A note with no headings is
 * plain markdown and draws no folds at all.
 *
 * `rehype-raw` is absent for the reason it is absent from the prep note and
 * the vault: with raw HTML off, react-markdown renders none of it.
 */

type Section = {
  level: number;
  title: string;
  body: string;
  children: Section[];
};

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/** Splits a note into the text before its first heading and a tree of sections. */
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

function Prose({ children }: { children: string }) {
  if (!children) return null;
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children: text, ...props }) {
          const external = /^https?:\/\//i.test(href ?? '');
          return (
            <a
              href={href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              {...props}
            >
              {text}
            </a>
          );
        },
        // An off-site image would report every read of the note to its host.
        img({ alt }) {
          return <em className="text-ink-muted">{alt ? `(image: ${alt})` : '(image)'}</em>;
        },
      }}
    >
      {children}
    </Markdown>
  );
}

/** The heading's own text, inline: emphasis and code survive, blocks do not. */
function Title({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      allowedElements={['strong', 'em', 'code', 'del', 'a']}
      unwrapDisallowed
    >
      {children}
    </Markdown>
  );
}

function Fold({ section }: { section: Section }) {
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
          <Title>{section.title}</Title>
        </span>
      </summary>
      <div className="fold-body">
        <Prose>{section.body}</Prose>
        {section.children.map((child, index) => (
          <Fold key={`${child.title}-${index}`} section={child} />
        ))}
      </div>
    </details>
  );
}

export function FoldingMarkdown({ markdown, className }: { markdown: string; className?: string }) {
  const { preamble, sections } = splitSections(markdown);
  return (
    <div className={cn('jobs-prose', className)}>
      <Prose>{preamble}</Prose>
      {sections.map((section, index) => (
        <Fold key={`${section.title}-${index}`} section={section} />
      ))}
    </div>
  );
}
