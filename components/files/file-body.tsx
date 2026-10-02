import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/cn';

/**
 * Markdown Dash wrote, rendered: a file's body, a step's result, a note at
 * the top of a goal.
 *
 * The rendering is the shared one (components/ui/markdown.tsx): tables, lists
 * and headings through GitHub-flavoured markdown, no raw HTML, and images
 * shown as their alt text.
 *
 * The typography is the vault's (.vault-prose in app/globals.css), since a
 * note and a file are the same kind of reading. `compact` is the smaller size
 * for text inside a step's row or a card, where the page's own type sets the
 * scale.
 */
export function FileBody({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  return (
    <Markdown
      markdown={markdown}
      className={cn('vault-prose break-words', compact && 'prose-compact')}
    />
  );
}
