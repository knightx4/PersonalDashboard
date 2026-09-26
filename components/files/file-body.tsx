import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

/**
 * Markdown Claude wrote, rendered: a file's body, a step's result, a note at
 * the top of a goal.
 *
 * Tables, lists and headings come through GitHub-flavoured markdown. Raw HTML
 * is not rendered (react-markdown drops it without rehype-raw), and images are
 * shown as their alt text: a run that quotes a web page could otherwise put an
 * image on the page that reports each view to whoever hosts it.
 *
 * The typography is the vault's (.vault-prose in app/globals.css), since a
 * note and a file are the same kind of reading. `compact` is the smaller size
 * for text inside a step's row or a card, where the page's own type sets the
 * scale.
 */
export function FileBody({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  return (
    <div className={cn('vault-prose break-words', compact && 'prose-compact')}>
      <Markdown
        remarkPlugins={[remarkGfm]}
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
          img({ alt }) {
            return <em className="text-ink-muted">{alt ? `(image: ${alt})` : '(image)'}</em>;
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
